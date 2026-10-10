import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createClaudePrintCommand, guardedSentence, LOCUST_GUARD_SAID } from '@teammate/runtime-adapters'
import type { ExecutableLaunch } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { endedIds, stoppedBecause } from '../../resources/locust-command-guard.mjs'
import type { GuardedProcess, ProcessLook } from '../../resources/locust-command-guard.mjs'
import { commandGuardSettings } from './command-guard.js'

/*
 * NO TEAMMATE ENDS YOUR BROWSER (0.717; by id, 0.718). Arena round 4,
 * 2026-10-09: two of five models on Auto tidied up a test browser with
 * `taskkill //F //IM msedge.exe` and `taskkill //F //IM chrome.exe`, which ends
 * every window of that browser on the computer, the person's own too. Claude
 * Code now asks locust-command-guard.mjs before every command (command-guard.ts).
 *
 * The next night, refused by name, Fable read the ids off `tasklist` and ended
 * the person's Chrome by id 13 seconds later -- the refusal had said to end
 * things by id. So an id is looked up too: ending it is refused when it is a
 * protected program this run did not start, and allowed when the run started
 * it. The table below is that night's, in miniature.
 */
const GUARD = fileURLToPath(new URL('../../resources/locust-command-guard.mjs', import.meta.url))

/** A row: its parent, its name, its command line, and when it started (the run's agent started at 4000). */
const row = (ppid: number, name: string, line = '', created = 0): GuardedProcess => ({ ppid, name, line, created })
const TABLE: ReadonlyMap<number, GuardedProcess> = new Map([
  // Explorer, from login: its own parent is long gone.
  [6000, row(5900, 'explorer.exe', '', 1000)],
  // The person's Chrome, started from the desktop.
  [10544, row(6000, 'chrome.exe', '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"', 2000)],
  [29988, row(10544, 'chrome.exe', '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --type=crashpad-handler', 2001)],
  // The person reopens Chrome while the run works: still Explorer's, still theirs.
  [12420, row(6000, 'chrome.exe', '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"', 5000)],
  // A Chrome the person started before the run from a window since closed: an orphan, older than the run.
  [11000, row(1111, 'chrome.exe', 'chrome.exe', 1500)],
  // The person's own dev server, and their editor.
  [8200, row(6000, 'node.exe', 'node server.js', 2500)],
  [8300, row(6000, 'Code.exe', '', 2600)],
  // Locust, the agent it started for this run, the run's shell and what the run started.
  [7000, row(6000, 'Locust.exe', '', 3000)],
  [7100, row(7000, 'claude.exe', '', 4000)],
  [7200, row(7100, 'bash.exe', '', 4100)],
  [7300, row(7200, 'chrome.exe', 'chrome.exe --headless=new --user-data-dir=C:\\tmp\\shot', 4200)],
  [7310, row(7300, 'chrome.exe', 'chrome.exe --type=renderer', 4201)],
  [7400, row(7200, 'node.exe', 'node dev-server.mjs', 4300)],
  // Started in the background by an earlier command, whose shell has ended: orphans, newer than Locust.
  [7500, row(7777, 'chrome.exe', 'chrome.exe --user-data-dir=C:\\tmp\\headed', 4500)],
  [7510, row(7500, 'chrome.exe', 'chrome.exe --type=gpu-process', 4501)],
  // Started in an EARLIER message, under an agent Locust has since let go (each message is a fresh agent).
  [7600, row(7650, 'vivaldi.exe', 'vivaldi.exe keep.js --user-data-dir=./test-profile', 3900)],
  // Another teammate's agent, on Node, and a browser that teammate started.
  [8100, row(7000, 'node.exe', 'node C:\\Users\\jane\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', 3500)],
  [8150, row(8100, 'chrome.exe', 'chrome.exe --user-data-dir=C:\\tmp\\theirs', 3550)],
  // A headless browser nobody here started: no windows to lose.
  [8400, row(6000, 'msedge.exe', 'msedge.exe --headless --dump-dom', 3600)],
  // This hook: its shell, under the run's agent.
  [8999, row(7100, 'bash.exe', '', 6000)],
  [9000, row(8999, 'electron.exe', '', 6001)]
])
const look = (): ProcessLook => ({ table: TABLE, root: 7000, agent: 7100, above: [8999, 7100, 7000, 6000] })
const noTable = (): undefined => undefined

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
      'taskkill /F /IM claude.exe',
      // Found by name, then ended through a variable: what the ids alone cannot show.
      'for p in $(tasklist //FI "IMAGENAME eq chrome.exe" //NH | awk \'{print $2}\'); do taskkill //F //PID $p; done',
      'powershell -c "foreach ($p in Get-Process chrome) { $p.Kill() }"'
    ]) {
      expect(stoppedBecause(command, noTable), command).toMatch(/^Locust stopped this command before it ran: it ends /)
    }
  })

  it('says what it would have ended, to leave it running, and never to go and find its ids', () => {
    expect(stoppedBecause('taskkill //F //IM chrome.exe', noTable)).toBe(
      "Locust stopped this command before it ran: it ends Chrome by name, which ends every Chrome on this computer, the person's own windows too. Leave the person's Chrome running. A test browser you start needs a profile of its own (--user-data-dir=<a new folder>), so it never meets theirs."
    )
    expect(stoppedBecause('taskkill /F /IM node.exe', noTable)).toBe(
      "Locust stopped this command before it ran: it ends Node by name, which ends every Node on this computer, the person's own programs and other teammates' work too. Leave the person's Node running. End only the processes this run started; Locust checks."
    )
    // 0.717 said "End only what you started yourself, by its process id: taskkill /PID <id> /F" -- and Fable went and found the ids.
    expect(stoppedBecause('taskkill //F //IM chrome.exe', noTable)).not.toMatch(/PID|process id/i)
  })
})

describe('a command that ends a process by id', () => {
  it('is stopped when the id is the person’s Chrome, as it was ended on 2026-10-10', () => {
    expect(stoppedBecause('taskkill //F //PID 10544 >/dev/null 2>&1; taskkill //F //PID 29988 >/dev/null 2>&1; sleep 1', look)).toBe(
      "Locust stopped this command before it ran: process 10544 is Chrome, which no teammate started, so it is the person's own. Leave it running. A test browser you start needs a profile of its own (--user-data-dir=<a new folder>), so it never meets theirs."
    )
    for (const command of ['powershell -c "Stop-Process -Id 10544 -Force"', 'powershell -c "Stop-Process -Id 7300,10544"', 'kill -9 29988', 'powershell -c "Stop-Process 10544"', 'node -e "process.kill(10544)"', 'wmic process where processid=10544 delete']) {
      expect(stoppedBecause(command, look), command).toMatch(/^Locust stopped this command before it ran: process (10544|29988) is Chrome/)
    }
    // Reopened by the person while the run works, or orphaned before the run began: still theirs.
    expect(stoppedBecause('taskkill //F //PID 12420', look)).toMatch(/^Locust stopped this command before it ran: process 12420 is Chrome/)
    expect(stoppedBecause('taskkill //F //PID 11000', look)).toMatch(/^Locust stopped this command before it ran: process 11000 is Chrome/)
  })

  it('is stopped for the person’s editor, another teammate’s agent, this run’s own agent, and Locust', () => {
    expect(stoppedBecause('taskkill //F //PID 8300', look)).toMatch(/process 8300 is VS Code, which no teammate started, so it is the person's own\./)
    expect(stoppedBecause('taskkill //F //PID 8100', look)).toMatch(/process 8100 is an AI agent on Node, which this run did not start, so it is another teammate's or the person's\./)
    expect(stoppedBecause('taskkill //F //PID 7100', look)).toMatch(/process 7100 is the agent this run is/)
    expect(stoppedBecause('taskkill //F //PID 7000', look)).toMatch(/process 7000 is Locust itself/)
  })

  it('runs when a teammate started it -- its own test browser, its own server -- or it is nobody’s to protect', () => {
    for (const command of [
      'taskkill //F //PID 7300',
      'taskkill //F //PID 7310 //T',
      'kill 7400',
      // Its own, left running in the background by an earlier command (the shell that started it has ended).
      'taskkill //F //PID 7500',
      'taskkill //F //PID 7510',
      // Its own from an EARLIER message: Locust starts the agent anew for each one (the drive found this, 10/10).
      'taskkill //F //PID 7600',
      // A browser another teammate started.
      'taskkill //F //PID 8150',
      // A headless browser has no windows to lose, whoever started it.
      'taskkill //F //PID 8400',
      'powershell -c "Stop-Process -Id 7400 -Force"',
      // The person's dev server is Node, which by id is anybody's server: let through, as the person may have asked.
      'taskkill //PID 8200 //F',
      // An id that is not running.
      'taskkill //PID 99999 //F',
      // An id in a variable cannot be read: let through.
      'taskkill //F //PID $CHROME_PID',
      // Listed, then its own ended by a written-out id: the id decides.
      'tasklist //FI "IMAGENAME eq chrome.exe"; taskkill //F //PID 7300'
    ]) {
      expect(stoppedBecause(command, look), command).toBeUndefined()
    }
    // A table that cannot be read lets an id through, saying nothing.
    expect(stoppedBecause('taskkill //F //PID 10544', noTable)).toBeUndefined()
  })

  it('reads the ids as each tool writes them', () => {
    expect(endedIds('taskkill //F //PID 10544 >/dev/null 2>&1; taskkill //F //PID 29988')).toEqual([10544, 29988])
    expect(endedIds('taskkill /PID 1 /PID 2 /T /F')).toEqual([1, 2])
    expect(endedIds('powershell -c "Stop-Process -Id 3,4 -Force"')).toEqual([3, 4])
    expect(endedIds('kill -9 5 6 && kill -s TERM 7')).toEqual([5, 6, 7])
    expect(endedIds('kill %1; pkill 8; taskkill //IM 9.exe')).toEqual([])
    expect(endedIds('node -e "process.kill(10)"')).toEqual([10])
  })
})

describe('everything else', () => {
  it('runs: starting a browser, and the ordinary work of a turn', () => {
    for (const command of [
      '"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless --screenshot=shot.png index.html',
      'start msedge http://localhost:8080',
      'node play.mjs bot.js example-bot.js',
      'npx playwright test',
      'git status && npm test',
      'grep -rn chrome src/ | head',
      'tasklist //FI "IMAGENAME eq chrome.exe"',
      'ls ~/locust-scratch/node_modules',
      'codex --version',
      ''
    ]) {
      expect(stoppedBecause(command, look), command).toBeUndefined()
    }
  })

  it('reads commands, not meaning: one that only writes such a command down is stopped too', () => {
    // Telling `echo "taskkill ..."` from `cmd //c "taskkill ..."` is reading the shell's meaning, which a
    // guard this small should not try. A file edit writes the same words without running anything.
    expect(stoppedBecause('echo "taskkill /IM chrome.exe" >> notes.txt', noTable)).toBeDefined()
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
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: stoppedBecause('taskkill //F //IM msedge.exe', noTable) }
    })
    expect(allowed).toEqual({ code: 0, out: '' })
    expect(garbled).toEqual({ code: 0, out: '' })
  })

  it('reads this machine’s real process table when an id is ended, and leaves an id nobody runs alone', async () => {
    // The table is read for real here (PowerShell on Windows, ps elsewhere); 999999 runs nowhere.
    const ended = await hook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'taskkill //F //PID 999999' } }))
    expect(ended).toEqual({ code: 0, out: '' })
  }, 30_000)
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

  it('names the guard as a hook its shell can start, on Locust’s own binary run as node, with Locust’s own id', () => {
    const settings = JSON.parse(
      commandGuardSettings({
        node: 'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Locust\\Locust.exe',
        guardPath: 'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Locust\\resources\\locust-command-guard.mjs',
        parent: 4242
      })
    )
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|PowerShell',
            hooks: [
              {
                type: 'command',
                command:
                  'ELECTRON_RUN_AS_NODE=1 LOCUST_GUARD_PARENT=4242 "C:/Users/Jane Doe/AppData/Local/Programs/Locust/Locust.exe" "C:/Users/Jane Doe/AppData/Local/Programs/Locust/resources/locust-command-guard.mjs"',
                timeout: 15
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
    const byName = stoppedBecause('taskkill //F //IM chrome.exe', noTable)!
    expect(byName.startsWith(LOCUST_GUARD_SAID)).toBe(true)
    expect(guardedSentence([{ text: 'Bash `taskkill //F //IM chrome.exe`', guarded: byName }])).toBe(
      'Locust stopped Bash `taskkill //F //IM chrome.exe` before it ran: it would have ended every Chrome on this computer, your own windows too. A teammate may end only what it started itself.'
    )
    const byId = stoppedBecause('taskkill //F //PID 10544', look)!
    expect(byId.startsWith(LOCUST_GUARD_SAID)).toBe(true)
    expect(guardedSentence([{ text: 'Bash `taskkill //F //PID 10544`', guarded: byId }])).toBe(
      'Locust stopped Bash `taskkill //F //PID 10544` before it ran: process 10544 is Chrome, which no teammate started, so it is yours. A teammate may end only what it started itself.'
    )
  })
})
