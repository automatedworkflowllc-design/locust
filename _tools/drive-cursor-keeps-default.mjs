// A Cursor teammate's run leaves the person's own Cursor default model as it
// was (0.431).
//
//   node _tools/drive-cursor-keeps-default.mjs [--packaged <exe>] [--tag <name>] [--model <id>]
//
// Spends: one short Cursor turn (Composer 2.5 by default). Run with
// LOCUST_SPEND=1.
//
// cursor-agent saves a run's --model as the person's default in
// ~/.cursor/cli-config.json. This drive reads ONLY the model fields there
// (model, selectedModel, modelSelectionHistory -- never the sign-in the file
// also holds) before and after a run. And whatever the build under test does,
// it puts those fields back itself at the end, reading them back: a control
// on an old build must not leave Colin's Cursor on the drive's model.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = arg('--model') ?? 'composer-2.5'
const OUT = join(recordRoot('cursor-keeps-default-2026-09-28'), `cursor-keeps-default-${tag}`)
await mkdir(OUT, { recursive: true })

const CONFIG = join(homedir(), '.cursor', 'cli-config.json')
const FIELDS = ['model', 'selectedModel', 'modelSelectionHistory']
const modelFields = async () => {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'))
  return Object.fromEntries(FIELDS.filter((field) => field in config).map((field) => [field, config[field]]))
}
const shown = (fields) => `${fields.model?.displayName ?? fields.model?.modelId ?? '?'} (${fields.selectedModel?.modelId ?? '?'})`
const before = await modelFields()
say(`  Cursor default before: ${shown(before)}`)

const drive = await startDrive({
  name: `cursor-keeps-default-${tag}`, port: 9767, workspace: await scratchRepository('locust-drive-cursor-default-ws-'), outPath: OUT, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'cursor', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Ada'))
  await sleep(800)
  const ran = String(await drive.capture('Ada on Cursor answers', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with just the word OK.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-160)
  })()`)))
  await sleep(3000)
  const after = await modelFields()
  say(`  Cursor default after the run: ${shown(after)}`)
  check('the run answered', /\bOK\b/.test(ran), ran)
  check("the person's Cursor default is what it was before the run", FIELDS.every((field) => JSON.stringify(after[field] ?? null) === JSON.stringify(before[field] ?? null)), `${shown(before)} -> ${shown(after)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on Cursor / ${MODEL}, Accept edits, one turn. Only the model fields of ~/.cursor/cli-config.json are read.`, extra: `Checks failed: ${String(failures)}` })
  // The drive's own safety net, whatever the build did.
  const now = await modelFields().catch(() => undefined)
  if (now !== undefined && !FIELDS.every((field) => JSON.stringify(now[field] ?? null) === JSON.stringify(before[field] ?? null))) {
    const text = await readFile(CONFIG, 'utf8')
    const config = JSON.parse(text)
    for (const field of FIELDS) {
      if (field in before) config[field] = before[field]
      else delete config[field]
    }
    await writeFile(`${CONFIG}.drive-restore`, JSON.stringify(config, null, 2), 'utf8')
    await rename(`${CONFIG}.drive-restore`, CONFIG)
    const back = await modelFields()
    say(`  (the drive put the Cursor default back: ${shown(back)}; ${FIELDS.every((field) => JSON.stringify(back[field] ?? null) === JSON.stringify(before[field] ?? null)) ? 'read back equal' : 'READ BACK DIFFERS'})`)
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
