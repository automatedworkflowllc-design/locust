// A Claude Code edit shows what it changed (0.672).
//
//   LOCUST_SPEND=1 node _tools/drive-a-claude-edit-shows-its-change.mjs [--packaged <exe>] [--tag <name>]
//
// Every Claude Code Edit and Write read "Claude Code did not report the
// change" -- 77 rows in Colin's own conversations (real-thread sweep,
// 2026-10-06) -- though Claude Code reports each change on the record that
// answers the call. Where the host can look at the folder itself it works
// the change out on its own (measured on 0.671, git or not); past its limits
// it cannot -- a file over 64 KB, a folder past 5,000 files, and Colin's was
// `.claude` -- and then the row said nothing. A teammate on Claude Haiku
// (Auto, so no approval card) changes one line of a 120 KB notes.txt and
// creates hello.md; the turn's files card must count each change (+1 -1,
// +3 -0) and no row may say it was not reported. 0.671 fails the first and
// the last. Spends one Haiku turn (about four cents).

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// A plain folder, and a file past the host's 64 KB (MAX_OBSERVED_FILE_BYTES): the case it cannot diff for itself.
const workspace = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-claude-edit-ws-'))
const filler = Array.from({ length: 3000 }, (_, at) => `filler line ${String(at + 1)}, kept only to make this file large.`).join('\n')
await writeFile(join(workspace, 'notes.txt'), `line one\nline two\nline three\n${filler}\n`, 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-claude-edit-shows-its-change-${tag}`, port: 9799, workspace, spends: true, keep: process.env.LOCUST_KEEP === "1",
  outPath: join(recordRoot('a-claude-edit-shows-its-change-2026-10-06'), tag),
  seed: {
    schemaVersion: 1,
    // --runtime cursor (0.692 night): Cursor's edits, 8 of 73 of which never reported back in Colin's
    // 10/05 turns. Cursor keeps the person's own model (choosing one rewrites their default).
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z',
      route: arg('--runtime') === 'cursor' ? { runtime: 'cursor', model: 'account-default', mode: 'auto' } : { runtime: 'claude', model: 'haiku', mode: 'auto' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 860)
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  const sent = await drive.evaluate(sendAndWaitScript("In notes.txt change 'line two' to 'line 2'. Then create hello.md containing a heading 'Hello' and one sentence. Use the Edit and Write tools. Nothing else."))
  say(`  sent: ${String(sent).slice(0, 100)}`)
  await sleep(1500)
  const rows = JSON.parse(String(await drive.capture('the files card', () => drive.evaluate(`(async () => {
    // The card's head is the button; its rows sit beside it.
    const head = [...document.querySelectorAll('.lc-thread button.lc-activity')].pop()
    if (head?.getAttribute('aria-expanded') === 'false') { head.click(); await new Promise((r) => setTimeout(r, 400)) }
    head?.scrollIntoView({ block: 'center' })
    return JSON.stringify([...(head?.parentElement?.querySelectorAll('.lc-filerow') ?? [])].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()))
  })()`))))
  for (const row of rows) say(`      ${row}`)
  const notes = rows.find((row) => /notes\.txt/.test(row)) ?? ''
  const hello = rows.find((row) => /hello\.md/.test(row)) ?? ''
  check('notes.txt reads as one line changed: +1 -1', /\+1\b/.test(notes) && /[−-]1\b/.test(notes), notes)
  check('hello.md reads as a new file of three lines: +3', /\+3\b/.test(hello), hello)
  check('no row says the change was not reported', rows.length > 0 && !rows.some((row) => /did not report|not confirmed/.test(row)), JSON.stringify(rows))
  // And the steps: an edit that never reported back reads "1 did not report" on its group's line.
  const stepLines = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-thread .lc-steps__line')].map((line) => line.innerText.replace(/\\s+/g, ' ').trim()))`)))
  say(`      steps: ${JSON.stringify(stepLines).slice(0, 300)}`)
  check('no step line says a step did not report', !stepLines.some((line) => /did not report/.test(line)), JSON.stringify(stepLines).slice(0, 300))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, Auto: one edit, one new file.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
