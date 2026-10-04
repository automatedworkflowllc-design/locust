import { describe, expect, it } from 'vitest'

import { commandReach } from './command-reach'

// The arena run, 2026-10-03: Opus ran this, and it stops every Python program
// on the computer. Nothing in the thread said so.
const ARENA = 'taskkill //F //IM python.exe'

// PowerShell's -EncodedCommand: UTF-16LE, then base64.
const encoded = (text: string): string => btoa([...text].map((ch) => String.fromCharCode(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8)).join(''))

const REACHES: readonly (readonly [string, string, string])[] = [
  // [command, kind, target]
  [ARENA, 'every-process-named', 'python.exe'],
  ['taskkill /F /IM node.exe', 'every-process-named', 'node.exe'],
  ['taskkill /IM Code.exe /T', 'every-process-named', 'code.exe'],
  ['taskkill /f /fi "IMAGENAME eq chrome.exe"', 'every-process-named', 'chrome.exe'],
  ['C:\\Windows\\System32\\taskkill.exe /IM python.exe', 'every-process-named', 'python.exe'],
  ['Stop-Process -Name node -Force', 'every-process-named', 'node'],
  ['spps -Name python', 'every-process-named', 'python'],
  ['kill -Name electron', 'every-process-named', 'electron'],
  ['Get-Process python | Stop-Process -Force', 'every-process-named', 'python'],
  ['Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process', 'every-process-named', 'node'],
  ["Get-Process | Where-Object { $_.Name -eq 'vite' } | Stop-Process", 'every-process-named', 'vite'],
  ['Stop-Process -Id (Get-Process python).Id', 'every-process-named', 'python'],
  ['pkill node', 'every-process-named', 'node'],
  ['pkill -9 python3', 'every-process-named', 'python3'],
  ['pkill -f "vite --port"', 'every-process-named', 'vite --port'],
  ['killall Electron', 'every-process-named', 'electron'],
  ['sudo killall -9 node', 'every-process-named', 'node'],
  ["wmic process where name='python.exe' delete", 'every-process-named', 'python.exe'],
  ['wmic process where "name=\'node.exe\'" call terminate', 'every-process-named', 'node.exe'],
  ['ps aux | grep vite | awk \'{print $2}\' | xargs kill -9', 'every-process-named', 'vite'],
  ['pgrep -f uvicorn | xargs kill', 'every-process-named', 'uvicorn'],
  ['kill $(pgrep node)', 'every-process-named', 'node'],
  ['pkill -u colin', 'every-process-of-user', 'colin'],
  ['kill -9 -1', 'every-process-of-user', 'you'],
  ['taskkill /F /FI "USERNAME eq alice"', 'every-process-of-user', 'alice'],
  ['kill -9 $(lsof -t -i:3000)', 'every-process-on-port', '3000'],
  ['lsof -ti tcp:5173 | xargs kill', 'every-process-on-port', '5173'],
  // The inverted grep names what is left out; the match before it names what is stopped (0.589).
  ['ps aux | grep python | grep -v grep | awk \'{print $2}\' | xargs kill', 'every-process-named', 'python'],
  ['fuser -k 8080/tcp', 'every-process-on-port', '8080'],
  ['npx kill-port 3000', 'every-process-on-port', '3000'],
  ['Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force', 'every-process-on-port', '3000'],
  // 0.586: Windows' older kill, and PowerShell's CIM and WMI terminate.
  ['tskill python', 'every-process-named', 'python'],
  ['tskill /A notepad', 'every-process-named', 'notepad'],
  ["Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | Invoke-CimMethod -MethodName Terminate", 'every-process-named', 'python.exe'],
  ["Get-WmiObject Win32_Process -Filter \"name='node.exe'\" | % { $_.Terminate() }", 'every-process-named', 'node.exe'],
  ["gwmi win32_process -filter \"Name = 'code.exe'\" | ForEach-Object { $_.Terminate() }", 'every-process-named', 'code.exe'],
  ['shutdown /l', 'every-process-of-user', 'you'],
  ['shutdown -h now', 'whole-machine', 'shut down'],
  ['shutdown /r /t 0', 'whole-machine', 'restart'],
  ['shutdown /s /t 60', 'whole-machine', 'shut down'],
  ['Restart-Computer -Force', 'whole-machine', 'restart'],
  ['Stop-Computer', 'whole-machine', 'shut down'],
  ['sudo reboot', 'whole-machine', 'restart'],
  ['systemctl poweroff', 'whole-machine', 'shut down'],
  // The shapes the runtimes really send: wrappers and chains.
  ['"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command \'Stop-Process -Name node -Force\'', 'every-process-named', 'node'],
  ['powershell -NoProfile -Command "Get-Process python | Stop-Process"', 'every-process-named', 'python'],
  [`powershell -NoProfile -EncodedCommand ${encoded('Stop-Process -Name node')}`, 'every-process-named', 'node'],
  ['cmd /c "taskkill /F /IM python.exe"', 'every-process-named', 'python.exe'],
  ['cmd.exe /s /c "npm run build && taskkill /IM node.exe /F"', 'every-process-named', 'node.exe'],
  ["bash -lc 'pkill -f vite || true'", 'every-process-named', 'vite'],
  ['"C:\\Program Files\\Git\\bin\\bash.exe" -lc "taskkill //F //IM python.exe 2>&1; echo done"', 'every-process-named', 'python.exe'],
  ['npm test; pkill node', 'every-process-named', 'node'],
  ['cd app && killall node & npm start', 'every-process-named', 'node']
]

const DOES_NOT: readonly string[] = [
  'taskkill /PID 1234',
  'taskkill /F /PID 1234 /T',
  // 0.586: one program by its number, and hibernate closes nothing.
  'tskill 1234',
  "Get-WmiObject Win32_Process -Filter \"processid=1234\" | % { $_.Terminate() }",
  'Get-CimInstance Win32_Process -Filter "name=\'python.exe\'" | Select-Object Name',
  'shutdown /h',
  'kill 1234',
  'kill -9 1234',
  'kill %1',
  'kill -TERM 4567 4568',
  'Stop-Process -Id 1234',
  'Stop-Process -Id $proc.Id',
  'Stop-Process 1234',
  '$p = Start-Process python -PassThru; Stop-Process -Id $p.Id',
  'echo "taskkill /IM python.exe"',
  "Write-Output 'Stop-Process -Name node'",
  'echo "pkill node" > notes.txt',
  // A separator inside quotes does not start a command.
  'echo "build done && taskkill /IM python.exe"',
  'git commit -m "tests pass; pkill node no longer needed"',
  'git commit -m "kill the old shutdown path"',
  'grep -rn "taskkill /IM" src',
  'Get-Process python',
  'ps aux | grep vite',
  'pgrep node',
  // Numbers from a file the run could see, filtered by an inverted grep: no match is named (0.589).
  'cat pids.txt | grep -v "^#" | xargs kill',
  'type pids.txt | findstr /v "#" | xargs kill',
  'shutdown /a',
  'npm run build && npm test',
  'python -m pytest -q',
  'cmd /c dir',
  'powershell -Command "Write-Output FIXTURE_APPROVAL"',
  "bash -lc 'ls -la'",
  'cat killall.log',
  'node scripts/kill-switch.js',
  'npm run build 2>&1 | tail -20',
  'wmic process where processid=1234 delete',
  'systemctl status nginx',
  'fuser 8080/tcp'
]

describe('a command that reaches programs it did not start is named', () => {
  it.each(REACHES)('%s', (command, kind, target) => {
    const reach = commandReach(command)
    expect(reach).toBeDefined()
    expect(reach?.kind).toBe(kind)
    expect(reach?.target).toBe(target)
  })

  it.each(DOES_NOT)('acts on its own or only says it: %s', (command) => {
    expect(commandReach(command)).toBeUndefined()
  })

  it('says it in words a person reads', () => {
    expect(commandReach(ARENA)).toEqual({
      kind: 'every-process-named',
      target: 'python.exe',
      short: 'stops every python.exe',
      said: 'Stops every python.exe on this computer, not only the ones this run started.'
    })
    expect(commandReach('kill -9 $(lsof -t -i:3000)')?.said).toBe('Stops whatever program is using port 3000, which may be one this run did not start.')
    expect(commandReach('shutdown /r /t 0')?.said).toBe('Restarts this computer, closing every program on it.')
  })
})
