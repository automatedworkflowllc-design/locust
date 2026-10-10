// An OpenCode teammate's commands pass Locust's command guard too (0.722).
//
//   node _tools/drive-an-opencode-command-is-guarded.mjs [--packaged <exe>]
//
// Claude Code (0.717), Codex (0.720) and Copilot (0.721) ask Locust's command
// guard before every command; 0.722 gives OpenCode the same, as a plugin file
// its config names (command-guard.ts). Here Oakley, on OpenCode's free
// Nemotron in Edit, runs one harmless command (`echo`) the guard lets through,
// on `opencode serve`, the route an ordinary turn takes. The guard writes a
// line per question when LOCUST_GUARD_LOG names a file, so the drive can show
// it was asked at all. Nothing is ever asked to end a program: what the guard
// refuses is covered by its tests (an-opencode-teammate-is-guarded-too.test.ts),
// through the plugin as OpenCode loads it. A free model; the person's own
// OpenCode config is checked unchanged.

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, openTeammateScript } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const openCodeConfig = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'opencode')
const fingerprint = async (path) => {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch {
    return '(none)'
  }
}
const configs = ['opencode.json', 'opencode.jsonc', 'config.json'].map((name) => join(openCodeConfig, name))
const settingsBefore = await Promise.all(configs.map(fingerprint))
const workspace = await scratchRepository('locust-drive-opencode-guard-ws-')
const guardLog = join(await mkdtemp(join(tmpdir(), 'locust-drive-guard-log-')), 'asked.jsonl')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `an-opencode-command-is-guarded${packaged === undefined ? '' : '-packaged'}`,
  port: 9889,
  workspace,
  env: { LOCUST_GUARD_LOG: guardLog },
  outPath: join(recordRoot('an-opencode-command-is-guarded-2026-10-10'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_oakley', name: 'Oakley', hue: 'lime', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-10-10T10:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'accept-edits' } }],
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
  await drive.evaluate(openTeammateScript('Oakley'))
  let route = ''
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
    if (/opencode/i.test(route)) break
  }
  say(`route: ${route}`)
  if (!/opencode/i.test(route) || !/nemotron/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}", not OpenCode's free Nemotron`)
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
  check('Locust’s guard was asked before OpenCode ran the command', asked.some((one) => one.tool === 'Bash' && /echo locust-guard-check/.test(one.command)), JSON.stringify(asked).slice(0, 500))
  check('and let the harmless command through', asked.length > 0 && asked.every((one) => one.refused === false) && /locust-guard-check/.test(text), text.slice(-400))
  check('nothing was refused, and no plugin failed to load', !/failed to load plugin|Locust stopped this command/i.test(lines.join('\n') + text), text.slice(-300))
  const settingsAfter = await Promise.all(configs.map(fingerprint))
  check('the person’s OpenCode config did not change', JSON.stringify(settingsAfter) === JSON.stringify(settingsBefore), `${JSON.stringify(settingsBefore)} -> ${JSON.stringify(settingsAfter)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Oakley on OpenCode, free Nemotron, Edit: one live turn running \`echo\`.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
