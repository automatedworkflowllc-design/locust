// A turn reads as it happens, and nothing moves when it ends (0.491).
//
//   LOCUST_SPEND=1 node _tools/drive-a-turn-reads-as-it-happens.mjs [--packaged <exe>] [--tag <name>] [--runtime claude|codex|cursor|opencode]
//
// Colin, 2026-09-30, with Claude Code's app beside Locust: "ALL of our
// commands and stuff that would appear batched on screen seem to all get
// rolled into the bar". A teammate on Claude Haiku (Auto, so no approval card
// lands on anyone's screen) says a sentence before each of three steps. The
// thread is sampled twice a second while it runs: the steps must show as
// lines among the sentences WHILE it works, and the finished turn must read
// in the same order the live one did -- nothing moved, nothing re-folded.
// Spends one Haiku turn.

import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// Each runtime on the route it already has: Cursor keeps the person's own model (choosing one rewrites their default).
const ROUTES = {
  claude: { runtime: 'claude', model: 'haiku', mode: 'auto' },
  codex: { runtime: 'codex', model: 'account-default', mode: 'auto' },
  cursor: { runtime: 'cursor', model: 'account-default', mode: 'auto' },
  opencode: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'auto' },
  // Auto: Antigravity's Edit cannot run commands (0.583). Colin, 2026-10-04, of a
  // Flash turn drawn as one bar: "make sure our outputs are proper across all channels".
  antigravity: { runtime: 'antigravity', model: 'account-default', mode: 'auto' },
  // The cross-model pass (0.586): Copilot CLI on the person's own account.
  copilot: { runtime: 'copilot', model: 'account-default', mode: 'auto' }
}
const runtime = arg('--runtime') ?? 'claude'
const route = ROUTES[runtime]
if (route === undefined) throw new Error(`no route for ${runtime}`)
const workspace = await scratchRepository('locust-drive-reads-as-it-happens-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-turn-reads-as-it-happens-${runtime}-${tag}`, port: 9797, workspace, spends: runtime !== 'opencode',
  outPath: join(recordRoot('a-turn-reads-as-it-happens-2026-09-30'), `${runtime}-${tag}`),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
// The thread as a reader meets it: each thing said, each step line, the live line, the foot.
const ORDER = `(() => [...document.querySelectorAll('.lc-thread .lc-agentline__body, .lc-thread .lc-livestep, .lc-thread .lc-turnfoot')]
  .map((el) => el.classList.contains('lc-turnfoot') ? 'FOOT'
    : el.classList.contains('lc-livestep') ? 'LIVE ' + el.innerText.replace(/\\s+/g, ' ').trim().replace(/(^| )(\\d+m )?\\d+s( |$)/, ' ').trim().slice(0, 40)
    : el.querySelector('.lc-steps__line') ? 'STEPS ' + el.querySelector('.lc-steps__line').innerText.replace(/\\s+/g, ' ').trim() + ' rows=' + String(el.querySelectorAll('.lc-steps__list .lc-filerow').length) + ' open=' + String(el.querySelector('.lc-steps__line').getAttribute('aria-expanded'))
    // A reply still arriving carries the caret (0.581: the live line stays under it).
    : (el.querySelector('.lc-caret') ? 'SAYING ' : 'SAID ') + el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 50))
  .filter((line) => line !== 'SAID ' && line !== 'SAYING '))()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 860)
  await drive.evaluate(openTeammateScript('Ash'))
  // Sample while it runs: the sampler lives in the page, beside the send.
  await drive.evaluate(`(() => { window.__samples = []; window.__sampler = setInterval(() => { window.__samples.push(${ORDER}) }, 500) })()`)
  const sent = await drive.evaluate(sendAndWaitScript('Do these three steps, and before EACH step write one short sentence saying what you are about to do: 1) read README.md, 2) run the shell command: node -e "console.log(6*7)", 3) run the shell command: node -e "console.log(Date.now() > 0)". Then reply with the single word DONE.'))
  say(`  sent: ${String(sent).slice(0, 100)}`)
  await sleep(1200)
  const samples = JSON.parse(String(await drive.evaluate(`(() => { clearInterval(window.__sampler); return JSON.stringify(window.__samples) })()`)))
  const final = JSON.parse(String(await drive.capture('finished: the turn as it happened', () => drive.evaluate(`JSON.stringify(${ORDER})`))))
  say(`  ${String(samples.length)} samples while it ran; final:`)
  for (const line of final) say(`      ${line.slice(0, 110)}`)
  // LOCUST_SAMPLES=1: each DIFFERENT sample in order, to read how a turn grew (0.691, OpenCode's group).
  if (process.env.LOCUST_SAMPLES === '1') {
    let previous = ''
    samples.forEach((sample, index) => {
      const shown = JSON.stringify(sample)
      if (shown !== previous) say(`    t=${String(index / 2)}s ${shown.slice(0, 260)}`)
      previous = shown
    })
  }
  // What the runtime said about its thinking, from the record: a thought's words, where it sent any.
  const thoughts = JSON.parse(String(await drive.evaluate(`(async () => {
    const history = await window.desktop.getMissionHistory()
    const events = history.ok ? history.data.missions.at(-1)?.events ?? [] : []
    return JSON.stringify(events.filter((e) => e.type === 'step.completed' && (e.payload.stepKind === 'reasoning' || /reasoning/i.test(e.payload.itemType ?? ''))).map((e) => String(e.payload.message ?? '').slice(0, 60)))
  })()`)))
  say(`  thoughts recorded: ${JSON.stringify(thoughts)}`)
  const live = samples.filter((sample) => sample.some((line) => line.startsWith('LIVE')))
  const both = live.find((sample) => sample.some((line) => line.startsWith('STEPS')) && sample.some((line) => line.startsWith('SAID') || line.startsWith('SAYING')))
  // A model that says nothing until its last word leaves nothing to show steps among (a free OpenCode
  // model did, 0.691): said, not failed, like the narration check below.
  const spokeWhileWorking = live.some((sample) => sample.some((line) => line.startsWith('SAID') || line.startsWith('SAYING')))
  if (!spokeWhileWorking) say('  (the model said nothing while it worked: nothing to show its steps among)')
  else check('while it worked, its steps were lines among what it said', both !== undefined, JSON.stringify(live.at(-1) ?? []).slice(0, 240))
  const saidFinal = final.filter((line) => line.startsWith('SAID'))
  const stepsFinal = final.filter((line) => line.startsWith('STEPS'))
  // A thought before the first sentence is its own line, and right: it happened first.
  const work = final.filter((line) => !/^STEPS Thought( for|$)/.test(line))
  // A model that did not narrate each step is the model's choice: said, not failed.
  if (saidFinal.length < 3) say(`  (the model said ${String(saidFinal.length)} thing(s), not one before each step: nothing to interleave)`)
  else check('the finished turn reads said, steps, said, steps ...', stepsFinal.length >= 2 && work[0]?.startsWith('SAID') === true, JSON.stringify(final).slice(0, 300))
  // Nothing moved: what was said, in the order it was drawn live, is the order it ends in.
  const lastLive = (live.at(-1) ?? []).filter((line) => line.startsWith('SAID') || line.startsWith('SAYING')).map((line) => line.replace(/^SAYING /, 'SAID ').slice(0, 30))
  // 0.581: while a reply arrives, the live line stays, saying it is writing.
  const saying = samples.filter((sample) => sample.some((line) => line.startsWith('SAYING')))
  const writing = saying.filter((sample) => sample.some((line) => /^LIVE .*Writing/.test(line)))
  if (saying.length === 0) say('  (no sample caught a reply mid-stream: nothing to say about the line under one)')
  else {
    // The samples that miss, with their live line, so a miss can be read (0.587).
    // Writing, or the plan's step under way: a runtime that reports a plan
    // (Cursor) leads the line with its current step while it narrates, as
    // Claude Code's status line does (0.493). What may not happen is no line.
    // `step \d+ of`, not `of \d+`: the sampler keeps 40 characters of the live line, and a long
    // step ("Run node -e ... step 2 of 3") is cut before its count (0.691 Cursor and Codex).
    const held = saying.filter((sample) => sample.some((line) => /^LIVE .*(Writing|step \d+ of)/.test(line)))
    const missing = saying.filter((sample) => !held.includes(sample))
    for (const sample of missing.slice(0, 3)) say(`  mid-stream without a live line: ${JSON.stringify(sample.filter((line) => /^(SAYING|LIVE)/.test(line))).slice(0, 240)}`)
    check('while a reply arrives, the live line stays: Writing, or the plan step under way', held.length === saying.length, JSON.stringify({ saying: saying.length, writing: writing.length, withPlanStep: held.length - writing.length, example: saying[0] }).slice(0, 300))
  }
  const finalSaid = saidFinal.map((line) => line.slice(0, 30))
  check('nothing moved when it ended: the live order of what was said is the final order', lastLive.every((line, index) => finalSaid[index] === line), JSON.stringify({ lastLive, finalSaid }))
  // 0.584: the group still growing shows its rows while it works.
  const grew = samples.filter((sample) => sample.some((line) => /^STEPS .* rows=[1-9]/.test(line)))
  // A model that narrates before EVERY step makes one-step groups, drawn as their line with no rows:
  // nothing grows (0.594 and 0.691 on Haiku alike). Judged only when some group gathered several steps.
  const several = final.some((line) => /^STEPS .*\b([2-9]|\d{2,}) (commands|files|searches|steps|reads|edits)\b/i.test(line))
  // A runtime that reports a step only once it has ENDED (OpenCode) never has a step under way to hold
  // its group open: the group stays folded and its line grows instead -- "Read README.md", "Read a file,
  // ran a command", "Read a file, ran 2 commands" -- as Claude Code folds finished steps. That growth,
  // seen live, is the same promise kept (0.691; the samples are in this drive's LOCUST_SAMPLES=1 output).
  const lastGroupLines = [...new Set(samples.map((sample) => sample.filter((line) => line.startsWith('STEPS')).at(-1)).filter(Boolean))]
  const lineGrew = lastGroupLines.length >= 2
  if (!several) say('  (every group held one step: nothing to grow)')
  else check('while it worked, the growing group showed its rows, or its line grew step by step', grew.length > 0 || lineGrew, `${String(grew.length)} of ${String(samples.length)} samples with rows; the line read ${JSON.stringify(lastGroupLines.map((line) => line.replace(/ rows=.*$/, '')))}`.slice(0, 300))
  // 0.594: once the run has moved on, a group folds to its line; only the one under way is open.
  const stacked = samples.map((sample) => sample.filter((line) => line.startsWith('STEPS'))).filter((lines) => lines.length >= 2)
  const unfolded = stacked.filter((lines) => lines.slice(0, -1).some((line) => / open=true/.test(line)))
  if (stacked.length === 0) say('  (no sample held two groups at once: nothing to say about folding)')
  else check('with two or more groups mid-run, every group but the last is folded', unfolded.length === 0, `${String(unfolded.length)} of ${String(stacked.length)} samples kept an earlier group open; example: ${JSON.stringify(unfolded[0] ?? stacked[0]).slice(0, 240)}`)
  check('the finished turn has its foot', final.at(-1) === 'FOOT' || final.includes('FOOT'), JSON.stringify(final.slice(-3)))
  await drive.capture('a group opened', () => drive.evaluate(`(async () => { document.querySelectorAll('.lc-thread .lc-steps__line')[1]?.click(); await new Promise((r) => setTimeout(r, 500)); return document.querySelector('.lc-thread .lc-steps__list')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'none' })()`))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on ${runtime} (${route.model}), three narrated steps, sampled while it ran.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
