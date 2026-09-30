// Grok (Cursor) answers in Compare on Windows, in the folder itself (0.485).
//
//   node _tools/drive-compare-cursor-no-copy.mjs [--packaged <exe>]
//
// Colin, 2026-09-30: an answers-only comparison of Grok and GPT-6 Sol in his
// `.claude` folder -- the Grok column "could not start": on Windows Cursor
// answered only in a copy of the folder, and the folder was too big to copy.
// Cursor now answers read-only in its own ask mode, in the folder. This makes
// a plain folder, starts an answers-only comparison of Cursor
// on its default model (no model is passed, so Colin's Cursor default is not
// touched) against a free OpenCode model, and reads both columns: each must
// answer, and no copy may be made under ~/.locust/compare. Spends one Cursor
// request (Colin's Grok) and one free request.

import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
await mkdir(join(homedir(), 'Documents', 'locust-scratch'), { recursive: true })
const workspace = await mkdtemp(join(homedir(), 'Documents', 'locust-scratch', 'locust-drive-cursor-nocopy-ws-'))
// Ten files, not 5,001: 0.485 makes no copy at all, so the folder's size no
// longer matters, and 5,001 fresh files kept the virus scanner busy long
// enough to hang the start (2026-09-30).
for (let index = 0; index < 10; index += 1) await writeFile(join(workspace, `note-${String(index)}.txt`), '', 'utf8')
await writeFile(join(workspace, 'README.md'), 'The project codename is KESTREL.\n', 'utf8')
const copies = async () => (await readdir(join(homedir(), '.locust', 'compare')).catch(() => [])).length
const copiesBefore = await copies()

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'compare-cursor-no-copy', port: 9767, workspace, launchElsewhere: true, spends: true,
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(3000)
  const within = (ms, what, promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${String(ms / 1000)} s`)), ms))])
  const started = JSON.parse(String(await within(60_000, 'starting the comparison', drive.evaluate(`(async () => {
    const answer = await window.desktop.startCompare({
      prompt: 'Read README.md and reply with only the project codename it names.',
      routes: [
        { runtime: 'cursor', model: 'account-default', label: 'Cursor default' },
        { runtime: 'opencode', model: ${JSON.stringify(FREE_ROUTE.model)}, label: 'Free model' }
      ]
    })
    return JSON.stringify(answer.ok ? { ok: true, compareId: answer.data.compare.compareId } : { ok: false, message: answer.error?.message ?? String(answer.message) })
  })()`))))
  check('an answers-only comparison with Cursor starts', started.ok === true, JSON.stringify(started))
  let columns = []
  for (let waited = 0; waited < 240_000; waited += 3000) {
    await sleep(3000)
    const listed = JSON.parse(String(await drive.evaluate(`window.desktop.listCompares().then((answer) => JSON.stringify(answer.ok ? answer.data.compares : []))`)))
    const compare = listed.find((entry) => entry.compareId === started.compareId)
    columns = compare?.slots ?? []
    const ended = await drive.evaluate(`(async () => {
      const missions = ${JSON.stringify(columns.flatMap((slot) => slot.missionIds))}
      if (missions.length < 2) return false
      const phases = await Promise.all(missions.map((id) => window.desktop.readMission(id).then((answer) => answer.ok ? answer.data.mission.phase : 'unknown', () => 'unknown')))
      // A live run reads "interrupted" in the record until it ends; only an end counts.
      return phases.every((phase) => phase === 'completed' || phase === 'failed' || phase === 'cancelled')
    })()`)
    if (ended === true) break
  }
  const replies = JSON.parse(String(await drive.capture('both columns, finished', () => drive.evaluate(`(async () => {
    const out = []
    for (const id of ${JSON.stringify(columns.flatMap((slot) => slot.missionIds))}) {
      const found = await window.desktop.readMission(id).catch(() => undefined)
      const events = found?.ok ? found.data.mission.events : []
      const text = events.filter((e) => e.type === 'message.delta').map((e) => e.payload.text ?? '').join('')
      out.push({ id, runtime: found?.ok ? found.data.mission.runtime : '?', phase: found?.ok ? found.data.mission.phase : '?', sandbox: found?.ok ? found.data.mission.sandbox : '?', text: text.slice(-120), error: events.filter((e) => e.type === 'run.failed').map((e) => e.payload.message).join(' ') })
    }
    return JSON.stringify(out)
  })()`))))
  say(`  columns: ${JSON.stringify(replies)}`)
  const cursor = replies.find((r) => r.runtime === 'cursor')
  const free = replies.find((r) => r.runtime === 'opencode')
  check('the Cursor column answered, read-only, from the folder itself', cursor !== undefined && /KESTREL/i.test(cursor.text) && cursor.sandbox === 'read-only', JSON.stringify(cursor))
  check('the free column answered too', free !== undefined && /KESTREL/i.test(free.text), JSON.stringify(free))
  check('no copy of the folder was made', (await copies()) === copiesBefore, `${String(copiesBefore)} -> ${String(await copies())}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Cursor on its default model against a free OpenCode model, answers only.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
