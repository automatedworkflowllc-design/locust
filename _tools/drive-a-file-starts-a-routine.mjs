// A file landing in a watched folder starts its routine (0.522, folder watchers).
//
//   LOCUST_SPEND=1 node _tools/drive-a-file-starts-a-routine.mjs [--packaged <exe>] [--tag <name>]
//
// Product ideas (Bloks note, item 2): "when a file lands in this folder, ask
// this teammate". A routine "on a new file in inbox", seeded for Wren on Codex
// (GPT-6-Luna, low: Codex quota, which may be spent). A file already in the
// inbox starts nothing; a new one does, once it has stopped changing, and the
// run is told its name and reads it (a routine always runs in Ask).

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-file-routine-ws-')
await mkdir(join(workspace, 'inbox'), { recursive: true })
await writeFile(join(workspace, 'inbox', 'already-here.txt'), 'This was here before the watcher.\n', 'utf8')
const profilePath = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-file-routine-profile-'))
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const WREN = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Custom', roleTitle: 'Inbox', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'ask', effort: 'low' } }
await writeFile(join(profilePath, 'routines.json'), JSON.stringify({
  schemaVersion: 1,
  routines: [{
    routineId: 'rt_inbox00000000000000000000',
    name: 'Read what lands in the inbox',
    teammateId: WREN.teammateId,
    route: WREN.route,
    steps: ['Read the new file and reply with its first line exactly, then the words INBOX READ.'],
    learnedFrom: ['mission_5e000000-0000-4000-8000-000900000000'],
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    runs: 0,
    schedule: { kind: 'files', folder: 'inbox' },
    workspaceId
  }]
}, null, 2), 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `file-starts-a-routine-${tag}`,
  port: 9844,
  spends: true,
  workspace,
  profilePath,
  outPath: join(recordRoot('a-file-starts-a-routine-2026-10-01'), tag),
  seed: { schemaVersion: 1, teammates: [WREN], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const conversations = `JSON.stringify([...document.querySelectorAll('.lc-convrow button.lc-conv')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()))`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1440, 900)
  const card = String(await drive.capture('Routines: the watcher', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('.lc-routinerow:not(.lc-routineadd)')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no routine'
  })()`)))
  check('the routine says it watches the inbox', /when a new file arrives in inbox · watching/.test(card), card)
  // The first look (a poll every 10 s, after the first routine tick): what is there starts nothing.
  await sleep(40_000)
  const before = JSON.parse(String(await drive.evaluate(conversations)))
  check('the file already in the inbox started nothing', before.length === 0, JSON.stringify(before))
  await writeFile(join(workspace, 'inbox', 'note-1043.txt'), 'Invoice 1043 was paid on Monday.\nSecond line.\n', 'utf8')
  say('  dropped inbox/note-1043.txt')
  let thread = ''
  for (let waited = 0; waited < 240_000; waited += 5_000) {
    await sleep(5_000)
    thread = String(await drive.evaluate(`(async () => {
      const row = [...document.querySelectorAll('.lc-convrow button.lc-conv')][0]
      if (!row) return ''
      row.click()
      await new Promise((r) => setTimeout(r, 800))
      return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    })()`))
    if (/Routine "Read what lands in the inbox" finished/.test(thread)) break
  }
  await drive.capture('the run the file started', () => drive.evaluate('1'))
  check('a new file started the routine, and the conversation says which file', /Started because a new file arrived: inbox\/note-1043\.txt\./.test(thread), thread.slice(0, 500))
  // The run was told the file's name: its reply names it, whether or not the model chose to open it.
  check('the run was told the file it is for', /note-1043/.test(thread.replace(/Started because[^.]*\.txt\./, '')), thread.slice(0, 500))
  const after = JSON.parse(String(await drive.evaluate(conversations)))
  check('one run, for the one new file', after.length === 1, JSON.stringify(after))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A routine on a new file in inbox, for Wren on Codex; one file dropped.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
