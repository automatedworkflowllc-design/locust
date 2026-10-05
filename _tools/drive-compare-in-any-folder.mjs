// A comparison that edits, in any folder (0.555).
//
//   node _tools/drive-compare-in-any-folder.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only (OpenCode's free tier): spends nothing.
//
// Colin, 2026-10-02: "First you set this janky shit to not allow auto, then i
// couldnt run it under normal folders because they were too big ... I just
// want to be able to run compare on auto sometimes and honestly dude maybe
// revisit the whole copy the whole folder thing". And, the same evening, a
// column's file chip said "That file is not there" for a file it wrote in its
// copy. Two plain folders (not git projects), Compare on Auto, two free
// models, each asked to write a small file:
//   1. too big to copy (20,001 files): never refused; the bar says they work
//      in the folder itself, and the file is in the folder;
//   2. small: each works in its own copy, the folder is untouched, and the
//      file each wrote is found where it wrote it.

import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { SCRATCH_ROOT } from './scratch-root.mjs'
import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { waitForCompareTerminals } from './compare-terminal-wait.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'nemotron-3-ultra-free,mimo-v2.6-flash-free').split(',')
const OUT = join(recordRoot('compare-in-any-folder-2026-10-02'), tag)
await mkdir(OUT, { recursive: true })
// Under Documents, like every drive folder: never AppData (memory cursorignore-blinds-appdata).
await mkdir(join(SCRATCH_ROOT), { recursive: true })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}

// LOCUST_DRIVE_ASK / LOCUST_DRIVE_FILE / LOCUST_DRIVE_FOLDER_NAME (0.638): the arena round's shape -- a
// folder with a project's name and a page to make -- to check a column writes at its copy's root, not
// in a folder named after the project (OpenCode did, told "You are working in the folder arena-rpg").
const FILE = process.env.LOCUST_DRIVE_FILE ?? 'hello.md'
const ASK = process.env.LOCUST_DRIVE_ASK ?? 'Write a file named hello.md that contains one line: hello. Write nothing else, then say in one sentence what you wrote.'
const FOLDER_NAME = process.env.LOCUST_DRIVE_FOLDER_NAME

/**
 * Two free models, on Auto, changing files: started as Send starts one
 * (App.tsx startCompare), then opened from the sidebar. The picker's own
 * clicks are other drives' (drive-compare-effort.mjs).
 */
const compareOnAuto = (drive, label) => drive.capture(label, () => drive.evaluate(`(async () => {
  const refusal = await window.desktop.compareChangesRefusal()
  const started = await window.desktop.startCompare({
    prompt: ${JSON.stringify(ASK)},
    routes: [
      { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free', mode: 'auto' },
      { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', label: 'Mimo V2.6 Flash Free', mode: 'auto' }
    ],
    changes: true
  })
  return JSON.stringify({ autoOffered: refusal === undefined || refusal === null, refusal: refusal ?? '', started: started.ok ? 'started' : started.error.message })
})()`)).then(async (said) => {
  // Started from outside the chat box, so the window reads its comparisons again, and opens this one.
  await drive.evaluate('location.reload(); 1')
  await sleep(5000)
  const opened = await drive.evaluate(`(async () => {
    let row
    for (let i = 0; i < 40 && !row; i += 1) {
      row = [...document.querySelectorAll('.lc-convrow button.lc-conv')].find((b) => b.innerText.trim().startsWith('vs'))
      if (!row) await new Promise((r) => setTimeout(r, 500))
    }
    row?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return row !== undefined
  })()`)
  return JSON.stringify({ ...JSON.parse(String(said)), opened })
})

const SHOWN = `JSON.stringify({
  bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
  states: [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim()),
  heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
  notThere: (document.querySelector('.lc-compare')?.innerText ?? '').includes('That file is not there'),
  keepTitle: document.querySelector('.lc-compare__foot .lc-primarybutton')?.title ?? '',
  open: document.querySelector('.lc-compare') !== null
})`
/** Every column's terminal receipt, never the label of a still-live ledger. */
const settled = async (drive, label) => {
  try {
    return await waitForCompareTerminals(async () => JSON.parse(String(await drive.evaluate(`(async () => {
      const shown = JSON.parse(${SHOWN})
      const listed = await window.desktop.listCompares()
      const compare = listed.ok ? listed.data.compares.at(-1) : undefined
      const columns = []
      for (const slot of compare?.slots ?? []) {
        const id = slot.missionIds.at(-1)
        const read = id === undefined ? undefined : await window.desktop.readMission(id)
        const mission = read?.ok ? read.data.mission : undefined
        columns.push({ slot: slot.slot, phase: mission?.phase, refused: slot.refused !== undefined,
          terminal: mission?.events.some(event => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) === true })
      }
      return JSON.stringify({ shown, columns })
    })()`))))
  } finally {
    await drive.capture(label, () => drive.evaluate(SHOWN))
  }
}

// 1. A folder too big to copy. LOCUST_DRIVE_ONLY_SMALL=1 skips it (20,001 files take a while to write).
if (process.env.LOCUST_DRIVE_ONLY_SMALL !== '1') {
  const workspace = await mkdtemp(join(SCRATCH_ROOT, 'locust-drive-anyfolder-big-'))
  for (let index = 0; index <= 20_000; index += 1) await writeFile(join(workspace, `note-${String(index)}.txt`), '', 'utf8')
  const drive = await startDrive({
    name: `compare-any-folder-big-${tag}`, port: 9873, workspace, outPath: join(OUT, 'big'), keep: process.env.LOCUST_DRIVE_KEEP === '1',
    ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true } }
  })
  try {
    await drive.ready()
    await drive.resize(1440, 900)
    await sleep(4000)
    const big = { ...JSON.parse(String(await compareOnAuto(drive, 'A folder of 20,001 files: two free models, Auto, sent'))), ...(await settled(drive, 'Both columns done')) }
    say(`  big: ${JSON.stringify(big)}`)
    check('Auto is offered for it, and it starts', big.autoOffered === true && big.started === 'started' && big.opened === true, JSON.stringify({ refusal: big.refusal, started: big.started, opened: big.opened }))
    check('the bar says they all work in the folder itself', /This folder is too big to give each its own copy, so they all work in your folder itself\./.test(big.bar), big.bar)
    check('both columns ran', big.heads.length === 2 && big.heads.every((head) => / done$/.test(head)), JSON.stringify(big.heads))
    check('what they wrote is in the folder', existsSync(join(workspace, 'hello.md')), readdirSync(workspace).filter((name) => !name.startsWith('note-')).join(', '))
    check('Keep says its changes are there already', /its changes are there already/.test(big.keepTitle), big.keepTitle)
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A plain folder of 20,001 files; two free models compared on Auto.`, extra: `Checks failed so far: ${String(failures)}` })
  }
}

if (process.env.LOCUST_DRIVE_ONLY_BIG !== '1') // 2. A small folder: each in its own copy, and each one's file found where it wrote it.
{
  const holder = await mkdtemp(join(SCRATCH_ROOT, 'locust-drive-anyfolder-small-'))
  const workspace = FOLDER_NAME === undefined ? holder : join(holder, FOLDER_NAME)
  if (FOLDER_NAME !== undefined) await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'README.md'), '# A small project\n', 'utf8')
  const drive = await startDrive({
    name: `compare-any-folder-small-${tag}`, port: 9874, workspace, outPath: join(OUT, 'small'),
    ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true } }
  })
  try {
    await drive.ready()
    await drive.resize(1440, 900)
    await sleep(4000)
    const small = { ...JSON.parse(String(await compareOnAuto(drive, 'A small folder: two free models, Auto, sent'))), ...(await settled(drive, 'Both columns done')) }
    say(`  small: ${JSON.stringify(small)}`)
    check('the bar says each changes its own copy, and that on Auto a model can still reach outside it', /Each changes its own copy of your project; only the one you keep comes into your folder\. On Auto, a model can still change files outside its copy if it is asked to\./.test(small.bar), small.bar)
    check('both columns ran', small.heads.length === 2 && small.heads.every((head) => / done$/.test(head)), JSON.stringify(small.heads))
    check('the folder is untouched while they compare', !existsSync(join(workspace, FILE)), readdirSync(workspace).join(', '))
    check('no column says a file it wrote is not there', small.notThere === false)
    // Each column's file, read where it wrote it, as its chip reads it.
    const found = JSON.parse(String(await drive.evaluate(`(async () => {
      const listed = await window.desktop.listCompares()
      const compare = listed.ok ? listed.data.compares.at(-1) : undefined
      const out = []
      for (const column of compare?.slots ?? []) {
        if (column.folder === undefined) { out.push({ slot: column.slot, folder: false }); continue }
        const read = await window.desktop.readTextFile(column.folder + '/' + ${JSON.stringify(FILE)})
        out.push({ slot: column.slot, ok: read.ok, text: read.ok ? read.text.trim() : read.message })
      }
      return JSON.stringify(out)
    })()`)))
    check("each column's own file is found in its copy, as its chip looks for it", found.length === 2 && found.every((one) => one.ok === true && (FILE === 'hello.md' ? /hello/i.test(one.text) : one.text.length > 0)), JSON.stringify(found.map((one) => ({ ...one, text: String(one.text).slice(0, 60) }))))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A small plain folder; two free models compared on Auto.`, extra: `Checks failed: ${String(failures)}` })
  }
}

say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
