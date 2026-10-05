// One decision path: an Always never outranks a rule (0.616, the PRD's R8).
//
//   node _tools/drive-an-always-never-outranks-a-rule.mjs [--packaged <exe>] [--tag <name>]
//   LOCUST_SPEND=1 node _tools/drive-an-always-never-outranks-a-rule.mjs --claude [--tag <name>]
//
// Wren -- on OpenCode in Approve each, or on Claude Code in Edit, the mode in
// which it has a shell -- with one rule saved against the third of four
// commands, run one at a time: two harmless ones (`echo one`, `echo two`; on
// Claude `node --version`, `npm --version`), the forbidden one, and
// `taskkill /IM locust-no-such-program.exe`, a name no program has, so it
// could stop nothing even if it ran. The first card is answered "Always allow
// this session". Before 0.616 each host answered by that Always itself, before
// the rules were read: OpenCode was told "always" and stopped asking, and
// Claude Code's host let every later Bash command through. Now:
//
//   - the second: no card; recorded as allowed by the Always on an earlier card;
//   - the forbidden one: denied by the saved rule, the Always notwithstanding;
//   - taskkill: a card (on Claude, again, saying why); the drive denies it.
//
// The record (dev build: the save dialog's seam) names who decided each. The
// PRD's "done when": the record of a run with an allowed rule, a card answered
// and a refusal names who decided each.
//
// A free model by default. --claude is Claude Code on Haiku, the path where
// the gap was widest: an Always there covered every command of the run.

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const claude = process.argv.includes('--claude')
const tag = `${claude ? 'claude' : 'opencode'}-${arg('--tag') ?? 'local'}`
const OUT = join(recordRoot('an-always-never-outranks-a-rule-2026-10-04'), tag)
await mkdir(OUT, { recursive: true })
const PROGRAM = 'locust-no-such-program.exe'
/*
 * Per runtime. OpenCode asks about every command in Approve each, and its own
 * pattern for `echo one` is `echo *`. Claude Code is given a shell only in
 * Edit (accept edits) -- in Approve each Locust runs it with reading tools
 * and connectors, and it said it had no shell (this drive's first Claude run)
 * -- and there it asks Locust's host about each command it does not run on
 * its own say; `echo` may be one it runs unasked, so it gets `node` and `npm`.
 */
// Claude Code runs some commands without asking anyone (`node --version`, in
// the second Claude run), so Always goes on the first harmless card it raises.
const COMMANDS = claude
  ? ['npm --version', 'npm --help', 'node --print 1+1', `taskkill /IM ${PROGRAM}`]
  : ['echo one', 'echo two', 'echo forbidden', `taskkill /IM ${PROGRAM}`]
const HARMLESS = claude ? [/npm --version/, /npm --help/] : [/echo one/, /echo two/]
const FORBIDDEN = claude ? /node --print/ : /echo forbidden/
const workspace = await scratchRepository('locust-always-rule-ws-')
const recordPath = join(OUT, 'saved-record.md')
const route = claude ? { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } : { ...FREE_ROUTE, mode: 'approve-each' }
const RULE = { ruleId: 'rule_drive_no_forbidden', effect: 'deny', kind: 'command', pattern: claude ? 'node --print:*' : 'echo forbidden:*', createdAt: '2026-10-04T00:00:00.000Z' }
const drive = await startDrive({
  name: `an-always-never-outranks-a-rule-${tag}`, port: 9796, workspace, outPath: OUT, keep: true, spends: claude, ...(packaged === undefined ? {} : { packaged }),
  env: { LOCUST_RECORD_PATH: recordPath },
  files: { 'approval-rules.json': { schemaVersion: 1, rules: [RULE] } },
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const running = async () => String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'true'
// The card on screen: its rows, its buttons, its note, and the request the window was sent for it.
const CARD = `JSON.stringify((() => {
  const actions = [...document.querySelectorAll('.lc-approval__actions')].at(-1)
  if (!actions) return { shown: false }
  const card = actions.closest('.lc-card')
  const rows = {}
  for (const dt of card?.querySelectorAll('.lc-receipt dt') ?? []) rows[dt.textContent.trim()] = dt.nextElementSibling?.textContent.replace(/\\s+/g, ' ').trim() ?? ''
  const buttons = [...actions.querySelectorAll('button')].map((b) => b.innerText.trim())
  const notes = [...(card?.querySelectorAll('.lc-approval__note') ?? [])].map((p) => p.textContent.replace(/\\s+/g, ' ').trim())
  const requests = window.__locustApprovals ?? []
  return { shown: true, rows, buttons, notes, approvalId: requests.at(-1)?.approvalId ?? null, alwaysKey: requests.at(-1)?.alwaysKey ?? null }
})())`
const press = (pattern) => `(() => {
  const button = [...document.querySelectorAll('.lc-approval__actions button')].find((b) => ${pattern}.test(b.innerText.trim()))
  button?.click()
  return button ? button.innerText.trim() : 'no such button'
})()`
const DENY = `(() => {
  const button = [...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Deny/.test(b.innerText.trim()))
  button?.click()
  return new Promise((r) => setTimeout(() => {
    const confirm = [...document.querySelectorAll('.lc-approval__actions button, .lc-card button')].find((b) => /^Deny$/.test(b.innerText.trim()) && b !== button)
    confirm?.click()
    r(button ? 'denied' : 'no deny button')
  }, 400))
})()`
const ledgerApprovals = async () => {
  const dir = join(drive.profile, 'mission-ledger')
  const approvals = []
  for (const name of (await readdir(dir).catch(() => [])).filter((entry) => entry.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(dir, name), 'utf8')).split(/\r?\n/)) {
      if (!line.includes('"mission.approval"')) continue
      try { const record = JSON.parse(line); approvals.push({ ...record.approval, schemaVersion: record.schemaVersion, missionFile: name }) } catch { /* a torn tail is not a record */ }
    }
  }
  return approvals.sort((first, second) => String(first.occurredAt).localeCompare(String(second.occurredAt)))
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`(() => { window.__locustApprovals = []; window.desktop.onMissionApproval((request) => { window.__locustApprovals.push(request) }); return true })()`)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(600)
  const task = `Run these four shell commands one at a time, each as its own separate tool call, in exactly this order, never combined: ${COMMANDS.map((command) => `\`${command}\``).join(', then ')}. Wait for each result before the next. If one is refused, say so in one line and go on to the next. When all four are done, reply with the word DONE.`
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(task)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'not sent'
  })()`))
  check('the task is sent', sent === 'sent', sent)
  const cards = []
  let lastId
  let pressedAlways = false
  // The harmless command the Always was given on, and the other one.
  let alwaysOn
  for (let i = 0; i < 600; i += 1) {
    await sleep(1000)
    const card = JSON.parse(String(await drive.evaluate(CARD)))
    if (card.shown && card.approvalId !== null && card.approvalId !== lastId) {
      lastId = card.approvalId
      const exact = card.rows.Exact ?? ''
      cards.push({ exact, buttons: card.buttons, notes: card.notes, alwaysKey: card.alwaysKey })
      const harmless = HARMLESS.find((pattern) => pattern.test(exact))
      if (!pressedAlways && harmless !== undefined) {
        alwaysOn = harmless
        await drive.capture(`the first card: ${exact.slice(0, 40)}, with Always`, async () => JSON.stringify(card))
        const pressed = String(await drive.evaluate(press('/^Always allow this session$/')))
        pressedAlways = pressed === 'Always allow this session'
        continue
      }
      await drive.capture(`a later card: ${exact.slice(0, 40)}`, async () => JSON.stringify(card))
      // Anything else the run asks is refused: the drive allows exactly one card.
      await drive.evaluate(DENY)
      continue
    }
    if (i > 10 && !(await running())) break
  }
  const other = HARMLESS.find((pattern) => pattern !== alwaysOn)
  await drive.capture('the run ended', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.slice(-1500)`))
  say(`  cards: ${JSON.stringify(cards).slice(0, 1500)}`)
  check('the first harmless card offered Always, and Always was pressed', pressedAlways, JSON.stringify(cards[0]))
  check(`its key is the ${claude ? 'tool' : 'runtime\'s own pattern'} an Always covers`, claude ? cards[0]?.alwaysKey === 'claude:Bash' : /^opencode:bash:echo \*?/.test(String(cards[0]?.alwaysKey)), cards[0]?.alwaysKey)
  check('no card for the other harmless command: the earlier Always covered it', other !== undefined && !cards.some((card) => other.test(card.exact)))
  check(`no card for ${COMMANDS[2]}: the saved rule answered it, the Always notwithstanding`, !cards.some((card) => FORBIDDEN.test(card.exact)))
  const taskkill = cards.find((card) => /taskkill/i.test(card.exact))
  if (claude) {
    // An Always on Bash covers every command, so this one was covered -- and is asked again, saying why.
    check('a card again for the command that reaches other programs, saying why', taskkill !== undefined && taskkill.notes.some((note) => /Asked again, though you chose Always earlier in this run: this command stops every locust-no-such-program\.exe/.test(note)), JSON.stringify(taskkill))
  } else {
    // OpenCode's Always covered `echo *` only: a card for it, as for any command it did not cover.
    check('a card for the command that reaches other programs, which the Always on echo * never covered', taskkill !== undefined && taskkill.alwaysKey !== cards[0]?.alwaysKey && !taskkill.buttons.includes('Always allow this session'), JSON.stringify(taskkill))
  }
  const approvals = await ledgerApprovals()
  say(`  approvals recorded: ${JSON.stringify(approvals.map((a) => ({ by: a.by, answer: a.answer, asked: String(a.asked).split('\n').at(-1), v: a.schemaVersion })))}`)
  const of = (pattern) => approvals.find((a) => pattern.test(String(a.asked)))
  check('the ledger is v21', approvals.length > 0 && approvals.every((a) => a.schemaVersion === 21), approvals.map((a) => a.schemaVersion).join(','))
  check('the Always: allowed for the session, by the person on the card', alwaysOn !== undefined && of(alwaysOn)?.by === 'card' && of(alwaysOn)?.answer === 'allowed-always', JSON.stringify(alwaysOn === undefined ? null : of(alwaysOn)))
  // OpenCode asks about every command, so the other one is on the record; Claude Code may run it unasked.
  const later = other === undefined ? undefined : of(other)
  check('the other harmless command: allowed by the Always on an earlier card' + (claude ? ', or run without asking' : ''), later === undefined ? claude : later.by === 'earlier-always' && later.answer === 'allowed', JSON.stringify(later ?? 'not asked'))
  check(`${COMMANDS[2]}: denied by the saved rule`, of(FORBIDDEN)?.by === 'saved-rule' && of(FORBIDDEN)?.answer === 'denied', JSON.stringify(of(FORBIDDEN)))
  check('taskkill: denied by the person, on its own card', of(/taskkill/i)?.by === 'card' && of(/taskkill/i)?.answer === 'denied', JSON.stringify(of(/taskkill/i)))
  if (packaged === undefined) {
    const missionId = approvals[0]?.missionFile?.replace(/\.jsonl$/, '')
    const saved = await drive.evaluate(`window.desktop.saveMissionRecord({ missionId: ${JSON.stringify(missionId)}, includeRaw: false }).then((r) => JSON.stringify(r))`)
    const record = await readFile(recordPath, 'utf8').catch(() => '')
    await drive.capture('the record saved', async () => `${String(saved)}\n\n${record.slice(0, 3000)}`)
    check('the saved record names who decided each', [
      'by the person, on the card · command',
      // Only when the runtime asked about it: Claude Code may run the second one unasked.
      ...(later === undefined ? [] : ['by the person’s Always on an earlier card of this run, with no card of its own · command']),
      'by a rule the person saved, before the card reached them · command'
    ].every((line) => record.includes(line)), record.slice(0, 600))
  }
  // One line is Electron's own at launch, in 206 drive records since 0.409 and not from this
  // code: "Electron sandboxed_renderer.bundle.js script failed to run". Anything else counts.
  const LAUNCH_NOISE = /^Electron sandboxed_renderer\.bundle\.js script failed to run|^console\.error$/
  const errors = drive.record.flatMap((entry) => entry.errors.map(String)).filter((line) => !LAUNCH_NOISE.test(line.trim()))
  check('no renderer errors in any capture, beyond Electron\'s launch line', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on ${claude ? 'Claude Code (Haiku)' : 'a free model'} in ${claude ? 'Edit' : 'Approve each'}, a rule saved against \`${COMMANDS[2]}\`; four commands, the first card answered Always.`, extra: `Checks failed: ${String(failures)}` })
  say(failures === 0 ? 'AN ALWAYS NEVER OUTRANKS A RULE: PASSED' : `AN ALWAYS NEVER OUTRANKS A RULE: FAILED (${String(failures)})`)
  process.exitCode = failures === 0 ? 0 : 1
}
