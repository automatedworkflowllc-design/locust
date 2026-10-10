import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createClaudePrintCommand, guardedSentence, LOCUST_GUARD_SAID } from '@teammate/runtime-adapters'
import type { ExecutableLaunch } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { stoppedBecause } from '../../resources/locust-command-guard.mjs'
import { commandGuardSettings } from './command-guard.js'

/*
 * NO TEAMMATE ENDS YOUR BROWSER (0.717). Arena round 4, 2026-10-09: two of
 * five models on Auto tidied up a test browser with `taskkill //F //IM
 * msedge.exe` and `taskkill //F //IM chrome.exe`, which ends every window of
 * that browser on the computer, the person's own too. Claude Code now asks
 * locust-command-guard.mjs before every command (command-guard.ts): ending a
 * program BY NAME is refused when the person or another teammate runs it;
 * ending what the teammate started, by its id, is not.
 */
const GUARD = fileURLToPath(new URL('../../resources/locust-command-guard.mjs', import.meta.url))

describe('a command that ends a program by name', () => {
  it('is stopped as round 4 ran it, and in every spelling of the same thing', () => {
    for (const command of [
      'taskkill //F //IM msedge.exe',
      'taskkill //F //IM chrome.exe',
      'taskkill /F /IM chrome.exe /T',
      'taskkill /IM chrome.exe /F',
      'TASKKILL //IM CHROME.EXE //F',
      'cd out && taskkill //F //IM msedge.exe 2>/dev/null; echo done',
      'taskkill /F /FI "IMAGENAME eq chrome.exe"',
      'cmd //c "taskkill /F /IM msedge.exe"',
      'powershell -NoProfile -Command "Stop-Process -Name chrome -Force"',
      'powershell -c "Stop-Process -Name node,msedge -ErrorAction SilentlyContinue"',
      'powershell -c "Get-Process msedge | Stop-Process -Force"',
      'powershell -c "(Get-Process -Name chrome).Kill()"',
      'pkill -f "Google Chrome"',
      'killall Safari',
      'pkill node',
      'pgrep -f chrome | xargs kill -9',
      'ps aux | grep firefox | awk \'{print $2}\' | xargs kill',
      'kill $(pgrep chromium)',
      'wmic process where "name=\'chrome.exe\'" delete',
      'powershell -c "Get-CimInstance Win32_Process -Filter \\"Name = \'msedge.exe\'\\" | Invoke-CimMethod -MethodName Terminate"',
      'osascript -e \'quit app "Google Chrome"\'',
      'taskkill /F /IM node.exe',
      'taskkill /F /IM Locust.exe',
      'taskkill /F /IM explorer.exe',
      'taskkill /F /IM msedgewebview2.exe',
      'taskkill /F /IM claude.exe'
    ]) {
      expect(stoppedBecause(command), command).toMatch(/^Locust stopped this command before it ran: it ends /)
    }
  })

  it('says what it would have ended, and how to end only its own', () => {
    expect(stoppedBecause('taskkill //F //IM chrome.exe')).toBe(
      "Locust stopped this command before it ran: it ends Chrome by name, which ends every Chrome on this computer, the person's own windows too. End only what you started yourself, by its process id: taskkill /PID <id> /F on Windows, or kill <id>."
    )
    expect(stoppedBecause('taskkill /F /IM node.exe')).toMatch(/ends every Node on this computer, the person's own programs and other teammates' work too\./)
  })
})

describe('everything else', () => {
  it('runs: ending by id, starting a browser, and the ordinary work of a turn', () => {
    for (const command of [
      'taskkill //PID 4242 //F',
      'taskkill /PID 4242 /T /F',
      'powershell -c "Stop-Process -Id 4242 -Force"',
      'kill 4242',
      'kill -9 %1',
      'taskkill //F //IM my-test-server.exe',
      'pkill -f my-dev-server',
      '"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless --screenshot=shot.png index.html',
      'start msedge http://localhost:8080',
      'node play.mjs bot.js example-bot.js',
      'npx playwright test',
      'git status && npm test',
      'grep -rn chrome src/ | head',
      'ls ~/locust-scratch/node_modules',
      'codex --version',
      ''
    ]) {
      expect(stoppedBecause(command), command).toBeUndefined()
    }
  })

  it('reads commands, not meaning: one that only writes such a command down is stopped too', () => {
    // Telling `echo "taskkill ..."` from `cmd //c "taskkill ..."` is reading the shell's meaning, which a
    // guard this small should not try. A file edit writes the same words without running anything.
    expect(stoppedBecause('echo "taskkill /IM chrome.exe" >> notes.txt')).toBeDefined()
  })

  it('is let through when the question cannot be read', () => {
    expect(stoppedBecause(undefined)).toBeUndefined()
    expect(stoppedBecause({ command: 'taskkill /IM chrome.exe' })).toBeUndefined()
  })
})

/** The real script, as Claude Code runs it: one PreToolUse event in, a deny or nothing out. */
async function hook(input: string): Promise<{ readonly code: number | null; readonly out: string }> {
  const child = spawn(process.execPath, [GUARD], { stdio: ['pipe', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => (out += chunk))
  child.stdin.end(input)
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  return { code, out }
}

describe('the hook Claude Code runs', () => {
  it('answers a refused command with a deny Claude Code reads, and anything else with nothing', async () => {
    const [refused, allowed, garbled] = await Promise.all([
      hook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'taskkill //F //IM msedge.exe', description: 'Close the test browser' } })),
      hook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })),
      hook('not json')
    ])
    expect(refused.code).toBe(0)
    expect(JSON.parse(refused.out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: stoppedBecause('taskkill //F //IM msedge.exe') }
    })
    expect(allowed).toEqual({ code: 0, out: '' })
    expect(garbled).toEqual({ code: 0, out: '' })
  })
})

describe('every Claude Code run', () => {
  const launch = { commandName: 'claude', discoveredPath: 'C:\\tools\\claude.exe', executablePath: 'C:\\tools\\claude.exe', prefixArgs: [], kind: 'native' } as unknown as ExecutableLaunch

  it('is given the guard in every mode, Auto included', () => {
    for (const sandbox of ['read-only', 'workspace-write', 'full-access'] as const) {
      const spec = createClaudePrintCommand(launch, { workspacePath: 'C:\\work\\pebble', prompt: 'go', sandbox, commandGuard: { settingsPath: 'C:\\data\\command-guard.json' } })
      const at = spec.args.indexOf('--settings')
      expect(spec.args.slice(at, at + 2), sandbox).toEqual(['--settings', 'C:\\data\\command-guard.json'])
    }
    // Without one (it could not be written), the run goes as before.
    expect(createClaudePrintCommand(launch, { workspacePath: 'C:\\work\\pebble', prompt: 'go', sandbox: 'full-access' }).args).not.toContain('--settings')
  })

  it('names the guard as a hook its shell can start, on Locust’s own binary run as node', () => {
    const settings = JSON.parse(commandGuardSettings({ node: 'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Locust\\Locust.exe', guardPath: 'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Locust\\resources\\locust-command-guard.mjs' }))
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|PowerShell',
            hooks: [
              {
                type: 'command',
                command: 'ELECTRON_RUN_AS_NODE=1 "C:/Users/Jane Doe/AppData/Local/Programs/Locust/Locust.exe" "C:/Users/Jane Doe/AppData/Local/Programs/Locust/resources/locust-command-guard.mjs"',
                timeout: 10
              }
            ]
          }
        ]
      }
    })
  })
})

describe('what the person is told', () => {
  it('is read from the guard’s own words, so the two cannot drift apart', () => {
    const reason = stoppedBecause('taskkill //F //IM chrome.exe')!
    expect(reason.startsWith(LOCUST_GUARD_SAID)).toBe(true)
    expect(guardedSentence([{ text: 'Bash `taskkill //F //IM chrome.exe`', guarded: reason }])).toBe(
      'Locust stopped Bash `taskkill //F //IM chrome.exe` before it ran: it would have ended every Chrome on this computer, your own windows too. Ending what the teammate started itself, by its process id, still works.'
    )
  })
})
