// A teammate's monthly limit, end to end on a build (0.353).
//
//   node _tools/drive-spend-limit.mjs [--packaged <exe>] [--tag <name>]
//
// Two teammates and three priced runs this month, written into the ledger
// with the ledger's own library before launch: Wren's two ($0.02 in all,
// one of them older than the newest twenty the window is sent) and Juno's
// ($1.50). Wren has a limit of one cent.
//
// It must show: on the Team screen, Wren "$0.02 of $0.01 . limit reached" in
// amber and Juno "$1.50"; a message to Wren refused with the limit's own
// sentence and the words back in the box; the Edit dialog's field holding
// 0.01 and saying what was spent; and, once the limit is raised to $5, the
// same message sent (on the free route, which prices nothing).

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { createFileMissionLedger } from '../packages/mission-store/dist/index.js'
import { FREE_ROUTE, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `spend-limit-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-spend-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
// This month, whatever day the drive runs on: the first of the month at noon,
// and later the same day, both before now.
const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1, 12).getTime()
const thisMonth = (hoursIn) => new Date(Math.min(now - 60_000, monthStart + hoursIn * 60 * 60 * 1000)).toISOString()

/*
 * The ledger, written by the ledger's own library -- so the files are exactly
 * what the app writes, and a change to the record format cannot leave this
 * drive seeding something the app would refuse to read.
 */
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-spend-limit-'))
const ledger = createFileMissionLedger({ rootDirectory: join(profile, 'mission-ledger') })
const processEvidence = (at) => ({
  exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 2, inputDeliveryFailed: false,
  outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: at, finishedAt: at
})
async function pricedRun(missionId, prompt, usd, at) {
  const runId = `run_${missionId}`
  await ledger.createMission({
    missionId, runId, prompt, runtime: 'opencode', model: 'opencode/a-paid-model', requestedRouteId: 'opencode',
    resolvedRouteId: 'opencode-account:default', cliVersion: 'drive', workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at
  })
  const event = (sequence, type, payload) => ({ id: `${missionId}_${String(sequence)}`, runId, missionId, sequence, occurredAt: at, sourceAdapter: 'opencode', type, payload })
  await ledger.appendEvents(missionId, [
    event(1, 'message.delta', { itemId: 'answer', operation: 'append', text: 'Done.', final: true, evidence: { redacted: true } }),
    event(2, 'run.completed', { usage: { usd, inputTokens: 1200, outputTokens: 80 }, process: processEvidence(at) })
  ])
}
await pricedRun('mission_wren_old', 'An older priced run of Wren', 0.01, thisMonth(1))
// Twenty-one unpriced runs of nobody's in between, so Wren's first is older
// than the newest twenty the window is sent with their events.
for (let index = 0; index < 21; index += 1) {
  const missionId = `mission_filler_${String(index).padStart(2, '0')}`
  const at = thisMonth(2 + index * 0.1)
  await ledger.createMission({
    missionId, runId: `run_${missionId}`, prompt: `Filler ${String(index)}`, runtime: 'opencode', model: 'opencode/a-free-model',
    requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: 'drive', workspaceId, sandbox: 'read-only',
    executionPolicyVersion: 1, createdAt: at
  })
}
await pricedRun('mission_wren_new', 'A newer priced run of Wren', 0.01, thisMonth(5))
await pricedRun('mission_juno', 'A priced run of Juno', 1.5, thisMonth(6))
await ledger.flush()

const LIMIT_SENTENCE = /Wren has reached this month's limit: \$0\.02 of \$0\.01\. Raise the limit by editing Wren, or it starts again on [A-Z][a-z]+ 1\./

const drive = await startDrive({
  name: 'spend-limit',
  port: 9613,
  workspace,
  profilePath: profile,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: new Date(now - 30 * DAY).toISOString(), route: FREE_ROUTE, monthlyLimitUsd: 0.01 },
      { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Research & Briefs', createdAt: new Date(now - 30 * DAY).toISOString(), route: FREE_ROUTE }
    ],
    missionOwners: { mission_wren_old: 'tm_wren', mission_wren_new: 'tm_wren', mission_juno: 'tm_juno' },
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const teamScreen = `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  for (let i = 0; i < 20 && !document.querySelector('.lc-rostercard'); i += 1) await new Promise((r) => setTimeout(r, 150))
  await new Promise((r) => setTimeout(r, 900))
  return [...document.querySelectorAll('.lc-rostercard')].map((card) => {
    const month = card.querySelector('.lc-rostercard__cost')
    return (card.querySelector('.lc-rostercard__name')?.textContent ?? '?') + ': ' + (month === null ? 'no month row' : month.innerText.replace(/\\s+/g, ' ') + (month.classList.contains('is-reached') ? ' [amber]' : ''))
  }).join(' || ')
})()`

const openWren = `(async () => {
  const face = ${teammateFace('Wren')}
  if (face) face.click()
  else {
    if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
    await new Promise((r) => setTimeout(r, 400))
    ;[...document.querySelectorAll('.lc-rostercard')].find((card) => card.querySelector('.lc-rostercard__name')?.textContent.trim() === 'Wren')?.querySelector('.lc-rostercard__message')?.click()
  }
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 150))
    if ((document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? '').startsWith('Message Wren')) return 'opened Wren'
  }
  return 'could not open Wren'
})()`

const refusalSeen = `(async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 200))
    const text = document.body.innerText.replace(/\\s+/g, ' ')
    const at = text.indexOf("reached this month's limit")
    if (at >= 0) return 'said: ' + text.slice(Math.max(0, at - 30), at + 190) + ' || box: ' + (document.querySelector('form.command-dock textarea')?.value ?? '?')
  }
  return 'no refusal on screen; box: ' + (document.querySelector('form.command-dock textarea')?.value ?? '?')
})()`

const editWren = `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 500))
  ;[...document.querySelectorAll('.lc-rostercard')].find((card) => card.querySelector('.lc-rostercard__name')?.textContent.trim() === 'Wren')?.querySelector('.lc-rostercard__edit')?.click()
  for (let i = 0; i < 20 && !document.querySelector('.lc-field--limit'); i += 1) await new Promise((r) => setTimeout(r, 150))
  await new Promise((r) => setTimeout(r, 600))
  const field = document.querySelector('.lc-field--limit')
  if (!field) return 'no limit field in the dialog'
  field.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  return 'field: ' + field.querySelector('input')?.value + ' || says: ' + field.querySelector('.lc-field__hint')?.textContent
})()`

const raiseLimit = `(async () => {
  const input = document.querySelector('.lc-field--limit input')
  if (!input) return 'no limit field'
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '5')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  ;[...document.querySelectorAll('.lc-dialog__foot button')].find((button) => /Save changes/.test(button.textContent))?.click()
  for (let i = 0; i < 20 && document.querySelector('.lc-field--limit'); i += 1) await new Promise((r) => setTimeout(r, 150))
  return document.querySelector('.lc-field--limit') ? 'dialog still open' : 'saved'
})()`

const verdicts = []
try {
  await drive.capture('launch: Wren at a one-cent limit, three priced runs this month', () => drive.ready())
  const team = await drive.capture('the Team screen: this month, against the limit', () => drive.evaluate(teamScreen))
  // "This month" is drawn in capitals by the stylesheet; innerText reads it so.
  verdicts.push(`card: ${/Wren: Limit reached \$0\.02 of \$0\.01 \[amber\]/i.test(team) && /Juno: This month \$1\.50/i.test(team) ? 'PASS' : 'FAIL'}`)
  await drive.capture('open Wren', () => drive.evaluate(openWren))
  const refused = await drive.capture('a message to Wren is refused, with the limit in its own words', async () => {
    const sent = await drive.evaluate(sendAndWaitScript('Say OK.', { settle: false }))
    return `${sent} || ${await drive.evaluate(refusalSeen)}`
  })
  verdicts.push(`refused: ${LIMIT_SENTENCE.test(refused) && /box: Say OK\./.test(refused) ? 'PASS' : 'FAIL'}`)
  const edit = await drive.capture("Wren's dialog: the limit and what was spent", () => drive.evaluate(editWren))
  verdicts.push(`dialog: ${/field: 0\.01/.test(edit) && /\$0\.02 spent this month so far\./.test(edit) ? 'PASS' : 'FAIL'}`)
  await drive.capture('raise it to $5 and save', () => drive.evaluate(raiseLimit))
  const after = await drive.capture('the Team screen after raising it', () => drive.evaluate(teamScreen))
  verdicts.push(`raised: ${/Wren: This month \$0\.02 of \$5\.00/i.test(after) && !/Wren:[^|]*\[amber\]/.test(after) ? 'PASS' : 'FAIL'}`)
  await drive.capture('open Wren again', () => drive.evaluate(openWren))
  const sentNow = await drive.capture('the same message now goes', async () => {
    const box = await drive.evaluate(`document.querySelector('form.command-dock textarea')?.value ?? ''`)
    const result = await drive.evaluate(sendAndWaitScript(box.length > 0 ? box : 'Say OK.', { waitSeconds: 240 }))
    return result
  })
  verdicts.push(`sent after raising: ${/^finished:/.test(sentNow) && !/reached this month's limit/.test(sentNow) ? 'PASS' : 'FAIL'}`)
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren (limit $0.01) and Juno, both on the free OpenCode model; three priced runs seeded with the ledger's own library, one older than the newest twenty. Verdicts: ${verdicts.join('; ')}` })
}
