// A teammate in Ask reads a Word file (0.530).
//
//   node _tools/drive-an-office-file-in-ask.mjs [--packaged <exe>] [--tag <name>]
//
// Sol's 0.528 pass: a free teammate in Ask declined to summarise a .docx --
// binary to its read tool, and Ask withholds the shell. Locust now keeps the
// words of each Word and PowerPoint file as text under .locust/office-words/
// and names them in the brief. A free OpenCode teammate (Fledge Alpha), in
// Ask, is asked what the report's table says for North; the answer must
// carry 120 and 150 (the cells), the folder's files must be unchanged, and
// git must not see the copies. Free: spends nothing.

import { execFileSync } from 'node:child_process'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/fledge-alpha-free'
const workspace = await scratchRepository('locust-drive-office-ask-ws-')
const report = fileURLToPath(new URL('../apps/desktop/test/documents/report-python-docx.docx', import.meta.url))
await copyFile(report, join(workspace, 'report.docx'))
const before = await readFile(join(workspace, 'report.docx'))
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `office-in-ask-${tag}`,
  port: 9852,
  workspace,
  outPath: join(recordRoot('an-office-file-in-ask-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_cedar', name: 'Cedar', hue: 'lime', role: 'Custom', roleTitle: 'Office', createdAt: '2026-10-01T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openTeammateScript('Cedar'))
  const mode = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Plan|Approve|Auto)\\b/.test(b.innerText))?.innerText.trim() ?? ''`))
  check('the composer is in Ask', /^Ask/.test(mode), mode)
  const sent = String(await drive.capture('asked about report.docx, in Ask', () => drive.evaluate(sendAndWaitScript('Without changing anything: what does the table in report.docx say for North? Give both numbers, then one sentence on what the document is about.', { waitSeconds: 300 }))))
  const answer = sent.slice(sent.lastIndexOf('what the document is about.') + 'what the document is about.'.length)
  check('the answer carries the North row\'s cells (120 and 150)', /\b120\b/.test(answer) && /\b150\b/.test(answer), answer)
  const after = await readFile(join(workspace, 'report.docx'))
  check('the document itself is unchanged', Buffer.compare(before, after) === 0)
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
  check('git sees none of Locust\'s copies', !/\.locust/.test(status), status.trim() || '(clean)')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Cedar on ${MODEL}, in Ask, asked about report.docx.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
