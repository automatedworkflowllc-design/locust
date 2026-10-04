// A conversation opens in its runtime's own terminal (0.387).
//
//   node _tools/drive-open-in-terminal.mjs [--packaged <exe>] [--tag <name>]
//
// Free model. Sable, on OpenCode's free model, is given a short job:
//   1. while it runs, the header's </> button is there and HELD, saying why;
//   2. once it has finished, the button is live and the ... menu offers the
//      same action;
//   3. pressed, it opens OpenCode's own interface on THIS conversation's
//      session -- the process is found by the session id the ledger holds,
//      with OpenCode's own resume flag -- and the window says where it went.
// The app runs with LOCUST_TERMINAL=console: a console window is one the
// drive can find by that session id and close. Windows Terminal, the
// route a person gets, was measured separately (0.387's commit) and is
// pinned by a-conversation-opens-in-its-own-terminal.test.ts.

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const { createFileMissionLedger } = await import('../packages/mission-store/dist/index.js')
const run = promisify(execFile)

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('open-in-terminal-2026-09-27'), `open-in-terminal-${tag}`)
await mkdir(OUT, { recursive: true })
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const LABEL = 'Open in OpenCode, in a terminal'

const workspace = await scratchRepository('locust-open-in-terminal-ws-')
const drive = await startDrive({
  name: `open-in-terminal-${tag}`,
  port: 9688,
  workspace,
  launchElsewhere: true,
  outPath: OUT,
  env: { LOCUST_TERMINAL: 'console' },
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: '2026-09-27T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const button = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
  const found = document.querySelector('button[aria-label=${JSON.stringify(LABEL)}]')
  return found === null ? null : { disabled: found.disabled, title: found.getAttribute('title') }
})())`)))
/** Processes started for this session (never PowerShell's own, which names it too). */
const processesFor = async (session) => {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -or $_.Name -eq 'opencode.exe') -and $_.CommandLine -like '*${session}*' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress`], { windowsHide: true })
  const parsed = stdout.trim().length === 0 ? [] : JSON.parse(stdout)
  return Array.isArray(parsed) ? parsed : [parsed]
}

let session
try {
  await drive.ready()
  await drive.resize(1440, 900)
  say(String(await drive.evaluate(openTeammateScript('Sable'))))
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Count from 1 to 60, one number per line, and nothing else. Do not use any tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const send = document.querySelector('button[aria-label="Send"]')
      if (send && !send.disabled) { send.click(); return 'sent' }
    }
    return 'could not send'
  })()`))
  // 1. While it runs: there, and held.
  let during = null
  for (let i = 0; i < 40 && (during === null || during.disabled === false); i += 1) {
    during = await button()
    if (during === null || during.disabled === false) await sleep(250)
  }
  await drive.capture('Sable working: the </> button, held', () => JSON.stringify(during))
  check('while Sable works, the </> button is there and held, saying why', sent === 'sent' && during?.disabled === true && /^Available when Sable finishes/.test(during.title ?? ''), JSON.stringify(during))

  // 2. Finished: live, and in the ... menu too.
  for (let i = 0; i < 240; i += 1) {
    const live = String(await drive.evaluate(`String(!!document.querySelector('button[aria-label^="Stop the running"]'))`)) === 'true'
    if (!live) break
    await sleep(500)
  }
  await sleep(800)
  const after = await button()
  const menu = String(await drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="More actions"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('[role=menuitem]')].map((item) => item.textContent.trim())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return JSON.stringify(items)
  })()`))
  await drive.capture('Sable finished: the </> button, live', () => JSON.stringify({ after, menu }))
  check('once Sable has finished, the button is live and says what opening means', after?.disabled === false && (after.title ?? '').includes("Locust won't see what you do there"), JSON.stringify(after))
  check('the ... menu offers the same, first', JSON.parse(menu)[0] === 'Open in terminal (OpenCode)', menu)

  // 3. Pressed: OpenCode's own interface, on THIS conversation's session.
  const ledger = createFileMissionLedger({ rootDirectory: join(drive.profile, 'mission-ledger') })
  const { missions } = await ledger.listMissions({ limit: 5 })
  const mission = missions[0]
  for (const event of mission?.events ?? []) {
    const id = event.payload?.runtimeThreadId
    if (typeof id === 'string' && id.length > 0) session = id
  }
  say(`the ledger's session: ${String(session)}`)
  await drive.evaluate(`document.querySelector('button[aria-label=${JSON.stringify(LABEL)}]')?.click()`)
  let notice = ''
  for (let i = 0; i < 40 && !/Opened in|could not|cannot|no OpenCode session/.test(notice); i += 1) {
    await sleep(250)
    notice = String(await drive.evaluate(`[...document.querySelectorAll('.lc-diagnostic')].map((line) => line.textContent.trim()).join(' | ')`))
  }
  await sleep(2500)
  const started = session === undefined ? [] : await processesFor(session)
  const tui = started.find((entry) => entry.Name === 'opencode.exe')
  await drive.capture('pressed: where it went', () => JSON.stringify({ notice, started: started.map((entry) => entry.Name) }))
  check('the window says where it opened, and that Locust will not see it', /Opened in a console window\. Locust won't see what happens there\./.test(notice), notice)
  check("OpenCode's own interface is running on this conversation's session, by its own flag", tui !== undefined && tui.CommandLine.includes(`--session ${session}`), tui?.CommandLine)
  say(failures === 0 ? '\nOPEN IN TERMINAL PASSED' : `\nOPEN IN TERMINAL: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  // Close what this drive opened -- only processes naming this session.
  if (session !== undefined) {
    for (const entry of await processesFor(session).catch(() => [])) {
      if (entry.Name === 'cmd.exe') await run('taskkill.exe', ['/PID', String(entry.ProcessId), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
    }
    const left = await processesFor(session).catch(() => [])
    say(left.length === 0 ? 'closed the console window this drive opened' : `STILL RUNNING: ${JSON.stringify(left.map((entry) => entry.Name))}`)
  }
  await drive.finish({ intro: `Sable on ${MODEL}: the </> button held while she works, live after; pressed, OpenCode's own interface on this conversation's session (console route, closed by the drive).` })
}
