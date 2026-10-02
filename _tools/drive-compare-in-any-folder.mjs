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

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'nemotron-3-ultra-free,mimo-v2.6-flash-free').split(',')
const OUT = join(recordRoot('compare-in-any-folder-2026-10-02'), tag)
await mkdir(OUT, { recursive: true })
// Under Documents, like every drive folder: never AppData (memory cursorignore-blinds-appdata).
await mkdir(join(homedir(), 'Documents', 'locust-scratch'), { recursive: true })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}

const ASK = 'Write a file named hello.md that contains one line: hello. Write nothing else, then say in one sentence what you wrote.'

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
/** The columns, once both have finished (or five minutes have passed). */
const settled = async (drive, label) => {
  let shown = {}
  for (let waited = 0; waited < 300_000; waited += 3000) {
    await sleep(3000)
    shown = JSON.parse(String(await drive.evaluate(SHOWN)))
    if (waited > 15_000 && !shown.open) break
    if (shown.states.length === 2 && shown.states.every((state) => state !== 'working' && state !== 'waiting')) break
  }
  await drive.capture(label, () => drive.evaluate('1'))
  return shown
}

// 1. A folder too big to copy.
{
  const workspace = await mkdtemp(join(homedir(), 'Documents', 'locust-scratch', 'locust-drive-anyfolder-big-'))
  for (let index = 0; index <= 20_000; index += 1) await writeFile(join(workspace, `note-${String(index)}.txt`), '', 'utf8')
  const drive = await startDrive({
    name: `compare-any-folder-big-${tag}`, port: 9873, workspace, outPath: join(OUT, 'big'),
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

// 2. A small folder: each in its own copy, and each one's file found where it wrote it.
{
  const workspace = await mkdtemp(join(homedir(), 'Documents', 'locust-scratch', 'locust-drive-anyfolder-small-'))
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
    check('the folder is untouched while they compare', !existsSync(join(workspace, 'hello.md')), readdirSync(workspace).join(', '))
    check('no column says a file it wrote is not there', small.notThere === false)
    // Each column's file, read where it wrote it, as its chip reads it.
    const found = JSON.parse(String(await drive.evaluate(`(async () => {
      const listed = await window.desktop.listCompares()
      const compare = listed.ok ? listed.data.compares.at(-1) : undefined
      const out = []
      for (const column of compare?.slots ?? []) {
        if (column.folder === undefined) { out.push({ slot: column.slot, folder: false }); continue }
        const read = await window.desktop.readTextFile(column.folder + '/hello.md')
        out.push({ slot: column.slot, ok: read.ok, text: read.ok ? read.text.trim() : read.message })
      }
      return JSON.stringify(out)
    })()`)))
    check("each column's own file is found in its copy, as its chip looks for it", found.length === 2 && found.every((one) => one.ok === true && /hello/i.test(one.text)), JSON.stringify(found))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A small plain folder; two free models compared on Auto.`, extra: `Checks failed: ${String(failures)}` })
  }
}

say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
