// A Copilot teammate's commands pass Locust's command guard too (0.721).
//
//   LOCUST_SPEND=1 node _tools/drive-a-copilot-command-is-guarded.mjs [--packaged <exe>]
//
// Claude Code (0.717) and Codex (0.720) ask Locust's command guard before
// every command; 0.721 gives Copilot the same, as a Claude-format plugin
// passed with `--plugin-dir` (command-guard.ts). Here Pilot, on Copilot's Auto
// model in Auto, runs one harmless command (`echo`) the guard lets through.
// The guard writes a line per question when LOCUST_GUARD_LOG names a file, so
// the drive can show it was asked at all. Nothing is ever asked to end a
// program: what the guard refuses is covered by its tests
// (a-copilot-teammate-is-guarded-too.test.ts), through PowerShell as Copilot
// runs it. One short turn on the person's Copilot account. Copilot's own
// settings are checked unchanged; the one empty folder Copilot keeps for the
// drive profile's plugin path is removed after.

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rmdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, openTeammateScript } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const copilotHome = process.env.COPILOT_HOME ?? join(homedir(), '.copilot')
const fingerprint = async (path) => {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch {
    return '(none)'
  }
}
const settingsBefore = { config: await fingerprint(join(copilotHome, 'config.json')), settings: await fingerprint(join(copilotHome, 'settings.json')) }
const pluginData = join(copilotHome, 'plugin-data', '_direct')
const pluginDataBefore = new Set(await readdir(pluginData).catch(() => []))
const workspace = await scratchRepository('locust-drive-copilot-guard-ws-')
const guardLog = join(await mkdtemp(join(tmpdir(), 'locust-drive-guard-log-')), 'asked.jsonl')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-copilot-command-is-guarded${packaged === undefined ? '' : '-packaged'}`,
  port: 9888,
  workspace,
  spends: true,
  env: { LOCUST_GUARD_LOG: guardLog },
  outPath: join(recordRoot('a-copilot-command-is-guarded-2026-10-10'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_pilot', name: 'Pilot', hue: 'lime', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-10-10T10:00:00.000Z', route: { runtime: 'copilot', model: 'auto', mode: 'auto' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 600)}`}`)
}
const thread = async () => String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
const running = async () => Boolean(await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`))
/** Every line any run of this profile recorded. */
const recorded = async () => {
  const lines = []
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.jsonl')) lines.push(...(await readFile(path, 'utf8')).split('\n').filter(Boolean))
    }
  }
  await walk(join(drive.profile, 'mission-ledger'))
  return lines
}
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openTeammateScript('Pilot'))
  let route = ''
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
    if (/copilot/i.test(route)) break
  }
  say(`route: ${route}`)
  if (!/copilot/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}", not Copilot`)
  const sent = await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Run this shell command once and reply with what it printed: echo locust-guard-check')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`)
  if (sent !== 'sent') throw new Error(String(sent))
  const ended = await drive.capture('the turn', async () => {
    for (let second = 0; second < 240; second += 1) {
      await sleep(1000)
      if (second > 5 && !(await running())) return second
    }
    return undefined
  })
  check('the turn ended on its own', ended !== undefined, `${String(ended)}s`)
  const text = await thread()
  const lines = await recorded()
  const asked = (await readFile(guardLog, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  check('Locust’s guard was asked before Copilot ran the command', asked.some((one) => one.tool === 'Bash' && /echo locust-guard-check/.test(one.command)), JSON.stringify(asked).slice(0, 500))
  check('and let the harmless command through', asked.length > 0 && asked.every((one) => one.refused === false) && /locust-guard-check/.test(text), text.slice(-400))
  check('nothing was refused, by the guard or by Copilot', !/Denied by preToolUse hook|hook errored|Locust stopped this command/i.test(lines.join('\n') + text), text.slice(-300))
  // The first run of this drive drew four lines under the answer for Copilot 1.0.95's new records (0.721 fixes it).
  check('no line about a Copilot record Locust did not know is drawn under the answer', !/Unhandled Copilot record|change to its background tasks/.test(text), text.slice(-300))
  const settingsAfter = { config: await fingerprint(join(copilotHome, 'config.json')), settings: await fingerprint(join(copilotHome, 'settings.json')) }
  check('the person’s Copilot settings did not change', JSON.stringify(settingsAfter) === JSON.stringify(settingsBefore), `${JSON.stringify(settingsBefore)} -> ${JSON.stringify(settingsAfter)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Pilot on Copilot, Auto model, Auto: one live turn running \`echo\`.`, extra: `Checks failed: ${String(failures)}` })
  // Copilot keeps an empty folder per plugin path; this drive's profile is gone, so is its folder.
  for (const name of await readdir(pluginData).catch(() => [])) {
    if (!pluginDataBefore.has(name)) await rmdir(join(pluginData, name)).catch(() => undefined)
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
