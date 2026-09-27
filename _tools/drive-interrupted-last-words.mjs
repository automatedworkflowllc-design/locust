// A turn cut off mid-work shows no answer it never gave (B15, 0.400).
//
//   node _tools/drive-interrupted-last-words.mjs [--packaged <exe>] [--tag <name>]
//
// Free model, spends nothing. One real turn in which Wren reads README.md
// and answers; a sentence before the read is written in (see the SEAM
// below). Then the ledger is cut just after the read STARTED -- exactly what a kill at that moment leaves (the ledger is append-
// only JSON lines; drive-crash-points kills at such points) -- and Locust is
// opened again on the same profile. The run now has no end: interrupted.
//
// Before 0.400 the sentence said before the read was drawn BELOW the fold,
// where the answer goes ("Let me check..." on a recovered routine run). Now it
// is in the fold, in its place, and nothing below poses as the answer.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('interrupted-last-words-2026-09-27'), `interrupted-last-words-${tag}`)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-last-words-ws-')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const READ = `(async () => {
  const row = ${teammateRows()}.find((r) => /Wren/.test(r.innerText))
  row?.conversation?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const toggle = document.querySelector('.lc-activity[aria-expanded="false"]')
  toggle?.click()
  await new Promise((r) => setTimeout(r, 500))
  return JSON.stringify({
    said: [...document.querySelectorAll('.lc-filerow--said')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()),
    below: [...document.querySelectorAll('.lc-agentline__body')].filter((body) => body.querySelector('.lc-card, .lc-activity, .lc-plan') === null).map((body) => body.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean),
    header: document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? ''
  })
})()`

let drive = await startDrive({ name: `last-words-${tag}`, port: 9711, workspace, seed, keep: true, outPath: OUT, ...(packaged === undefined ? {} : { packaged }) })
let handoff
let cut = false
try {
  await drive.ready()
  await drive.resize(1300, 860)
  await drive.evaluate(`(async () => { const row = ${teammateRows()}.find((r) => /Wren/.test(r.innerText)); (row?.face ?? row?.conversation)?.click(); await new Promise((r) => setTimeout(r, 600)) })()`)
  const answered = await drive.capture('a finished turn: a sentence, a read, an answer', () =>
    drive.evaluate(sendAndWaitScript('Before each step, say in a few words what you are about to do. Read README.md and tell me its first line, then the word DONE. Change nothing.', { waitSeconds: 240 })))
  say(`  finished turn: ${String(answered).slice(0, 160)}`)
  const finished = JSON.parse(String(await drive.evaluate(READ)))
  check('finished: the answer is below the fold', finished.below.some((text) => /DONE/.test(text)), JSON.stringify(finished.below).slice(0, 200))
  handoff = await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on a free model, in Ask; one finished turn.`, last: false })

  // Cut the ledger just after the read began: what a kill there leaves.
  const dir = join(handoff.profile, 'mission-ledger')
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const lines = (await readFile(join(dir, name), 'utf8')).split('\n').filter((line) => line.trim().length > 0)
    const types = lines.map((line) => { try { return JSON.parse(line)?.event?.type ?? '' } catch { return '' } })
    const lastTool = types.lastIndexOf('tool.started')
    if (lastTool < 0 || !types.includes('run.completed')) continue
    /*
     * A SEAM, said plainly: the model does not reliably narrate before a tool
     * (three runs, three reads with nothing said first), so the sentence is
     * written into the real ledger -- the turn's own final message record,
     * copied, with its own id and text, just before the read. Sequences stay
     * contiguous (the read moves up one), as the ledger requires.
     */
    const reply = lines[types.lastIndexOf('message.delta')]
    const read = JSON.parse(lines[lastTool])
    const narration = JSON.parse(reply)
    narration.ledgerSequence = read.ledgerSequence
    narration.occurredAt = read.occurredAt
    narration.event = { ...narration.event, id: `${read.event.id}-said`, sequence: read.event.sequence, occurredAt: read.occurredAt, payload: { ...narration.event.payload, itemId: 'said-before-read', text: 'Let me check the readme first.', final: true } }
    read.ledgerSequence += 1
    read.event = { ...read.event, sequence: read.event.sequence + 1 }
    const kept = [...lines.slice(0, lastTool), JSON.stringify(narration), JSON.stringify(read)]
    await writeFile(join(dir, name), `${kept.join('\n')}\n`, 'utf8')
    say(`  cut ${name.slice(0, 20)}: ${String(lines.length)} -> ${String(kept.length)} lines, a sentence before the read`)
    cut = true
  }
  check('a ledger was cut', cut)
} catch (error) {
  failures += 1
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  drive = await startDrive({ name: `last-words-${tag}`, port: 9711, workspace, profilePath: handoff.profile, outPath: handoff.out, stepFrom: handoff.step, ...(packaged === undefined ? {} : { packaged }) })
  await drive.ready()
  await drive.resize(1300, 860)
  const shown = JSON.parse(String(await drive.capture('opened again: the turn was cut off mid-read', () => drive.evaluate(READ))))
  check('the sentence said before the read is in the fold', shown.said.some((text) => /Let me check the readme first/.test(text)), JSON.stringify(shown.said).slice(0, 200))
  check('the conversation reads interrupted', /interrupted/.test(shown.header), shown.header)
  check('and nothing below the fold poses as the answer', shown.below.length === 0, JSON.stringify(shown.below).slice(0, 200))
} catch (error) {
  failures += 1
  say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The same profile, opened again after the ledger was cut just after the read began.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
