// Fresh-eyes area 24: someone doing finance cleans a spreadsheet and gets a summary.
//
//   node _tools/drive-a-spreadsheet-cleanup.mjs [--packaged <exe>] [--tag <name>]
//
// The spreadsheet is in the project folder, as it would be for a person who
// keeps the books there: sales.csv, with a repeated row, blank lines, three
// ways of writing a date and amounts written "$1,200.00". Ada (a free model,
// Edit) is asked in a bookkeeper's words to clean it into sales-clean.csv and
// say the revenue by month. The drive checks the file and the totals against
// its own arithmetic, and photographs how the result reads. Free model.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const model = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('a-spreadsheet-cleanup-2026-09-28'), `a-spreadsheet-cleanup-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-sheet-ws-', 'The bakery\'s books. sales.csv is the sales export.\n')
// July: 1200 + 350.5 + 89.99 = 1640.49 ; August: 2000 + 410 = 2410 ; September: 75.25
const MESSY = [
  'Date,Customer,Amount',
  '07/03/2026,Harbor Cafe,"$1,200.00"',
  '2026-07-15,Maple Deli,$350.50',
  '',
  '2026-07-15,Maple Deli,$350.50',
  'Jul 28 2026,Oak Street Market,89.99',
  '08/02/2026,Harbor Cafe,"$2,000.00"',
  '',
  '2026-08-19,Maple Deli,410',
  '09/01/2026,Oak Street Market,$75.25',
  ''
].join('\n')
await writeFile(join(workspace, 'sales.csv'), MESSY, 'utf8')
await git(['add', '-A'], workspace)
await git(['commit', '-q', '-m', 'sales export'], workspace)

const drive = await startDrive({
  name: `sheet-${tag}`, port: 9755, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Data & Reporting', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model, mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
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
  const ran = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'sales.csv is our sales export and it is a mess. Clean it up into sales-clean.csv: drop the blank lines and the repeated row, write every date as YYYY-MM-DD, and every amount as a plain number like 1200.00. Keep the original as it is. Then tell me the total revenue for each month.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
    }
    return 'timed out'
  })()`))
  await sleep(3000)
  const thread = String(await drive.capture('the cleanup, and the summary', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`)))
  say(`  turn: ${thread.slice(-700)}`)
  check('the run ended', ran === 'ended', ran)

  const original = await readFile(join(workspace, 'sales.csv'), 'utf8')
  check('the original is left as it was', original === MESSY)
  const clean = await readFile(join(workspace, 'sales-clean.csv'), 'utf8').catch(() => undefined)
  say(`  sales-clean.csv: ${JSON.stringify(clean)}`)
  const rows = (clean ?? '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  check('sales-clean.csv has the header and six rows, no blanks, no repeat', rows.length === 7, String(rows.length))
  check('every date is YYYY-MM-DD', rows.slice(1).every((row) => /^\d{4}-\d{2}-\d{2},/.test(row)), JSON.stringify(rows.slice(1, 3)))
  check('every amount is a plain number', rows.slice(1).every((row) => /,\d+(\.\d+)?$/.test(row)), JSON.stringify(rows.slice(1, 3)))
  const said = thread.slice(-900)
  check('the summary gives each month right: 1640.49, 2410, 75.25', /1,?640\.49/.test(said) && /2,?410(\.00)?/.test(said) && /75\.25/.test(said), said.slice(-300))

  // How the result reads: the file's card, opened.
  const card = String(await drive.capture('the new file, as the thread shows it', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-thread *')].find((el) => el.children.length === 0 && /sales-clean\\.csv/.test(el.textContent ?? ''))
    row?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 600))
    return JSON.stringify({ sheet: !!document.querySelector('.lc-sheetview, [class*="sheet"]'), near: row?.closest('.lc-filerow, .lc-activity, .lc-card')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? '' })
  })()`)))
  say(`  file card: ${card}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A messy sales.csv in the project folder; Ada on ${model}, Edit.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
