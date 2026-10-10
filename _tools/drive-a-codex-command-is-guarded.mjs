// A Codex teammate's commands pass Locust's command guard too (0.720).
//
//   LOCUST_SPEND=1 node _tools/drive-a-codex-command-is-guarded.mjs [--packaged <exe>]
//
// Since 0.717 Claude Code asks Locust's command guard before every command;
// 0.720 gives Codex the same, as a hook in the config each thread starts with
// (command-guard.ts). Here Cody, on GPT-6-Luna (Low), runs one harmless
// command (`echo`) the guard lets through. Codex's own app-server reports each
// hook it runs (`hook/started`, `hook/completed`), and Locust records every
// notification, so the run's record says whether the guard ran, and on what.
// Nothing is ever asked to end a program: what the guard refuses is covered by
// its tests (a-codex-teammate-is-guarded-too.test.ts), through PowerShell as
// Codex runs it. One short turn on the person's Codex account, its cheapest
// model; the person's config.toml is checked unchanged.

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, openTeammateScript } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const configToml = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml')
const fingerprint = async () => {
  try {
    return createHash('sha256').update(await readFile(configToml)).digest('hex')
  } catch {
    return '(none)'
  }
}
const configBefore = await fingerprint()
const workspace = await scratchRepository('locust-drive-codex-guard-ws-')
const guardLog = join(await mkdtemp(join(tmpdir(), 'locust-drive-guard-log-')), 'asked.jsonl')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-codex-command-is-guarded${packaged === undefined ? '' : '-packaged'}`,
  port: 9887,
  workspace,
  spends: true,
  env: { LOCUST_GUARD_LOG: guardLog },
  outPath: join(recordRoot('a-codex-command-is-guarded-2026-10-10'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_cody', name: 'Cody', hue: 'lime', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-10-10T10:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', effort: 'low', mode: 'auto' } }],
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
  await drive.evaluate(openTeammateScript('Cody'))
  let route = ''
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
    if (/codex/i.test(route)) break
  }
  say(`route: ${route}`)
  if (!/codex/i.test(route) || !/luna/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}", not Codex on Luna`)
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
  check('Locust’s guard was asked before Codex ran the command', asked.some((one) => one.tool === 'Bash' && /echo locust-guard-check/.test(one.command)), JSON.stringify(asked).slice(0, 500))
  check('and let the harmless command through', asked.length > 0 && asked.every((one) => one.refused === false) && /locust-guard-check/.test(text), text.slice(-400))
  check('nothing was refused, by the guard or by Codex', !/blocked by PreToolUse hook|Locust stopped this command/i.test(lines.join('\n') + text), text.slice(-300))
  check('Codex’s notice of the trust bypass is not shown: it is Locust’s own, for its own guard', !/bypass-hook-trust/.test(text), text.slice(-300))
  // Codex itself trusts a folder an Auto run opens, in config.toml, as it has for every Codex drive before
  // this one (MEASURED 2026-10-10: 189 such entries, one per scratch folder). Nothing else may change.
  const afterText = await readFile(configToml, 'utf8').catch(() => '')
  const trusted = `[projects.'${workspace.toLowerCase()}']\ntrust_level = "trusted"\n`
  const after = createHash('sha256').update(afterText.replace(`\n${trusted}`, '')).digest('hex')
  check('the person’s Codex config.toml did not change, but for Codex trusting this folder', after === configBefore, `${configBefore.slice(0, 12)} -> ${after.slice(0, 12)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Cody on Codex, GPT-6-Luna (Low), Auto: one live turn running \`echo\`.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
