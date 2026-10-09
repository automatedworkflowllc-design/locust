// Stop a run that is part way through writing files, and read what it says (0.530).
// Colin: "its counts add up (finished + cut off + never started = the plan's steps);
// FINISHED never lists the workspace folder". Card-only uncertainty, one warning.
//
//   node _tools/drive-stop-a-live-run.mjs [--packaged <exe>] [--tag <name>]
//   LOCUST_SPEND=1 LOCUST_RUNTIME=codex LOCUST_MODEL=gpt-6-luna node _tools/drive-stop-a-live-run.mjs ...
//
// Sol's 0.512 Workflow 3 left "Stop on a live Codex run" unverified (quota),
// and its 0.528 brief asked again. A teammate in Edit is asked to write six
// files one at a time, waiting between them; once the first is on DISK, Stop
// is pressed. The run must stop -- no file may land afterwards -- and the
// card must say the person stopped it and, since files were written, must not
// claim nothing happened. Free OpenCode by default; Codex (GPT-6-Luna, low)
// with LOCUST_RUNTIME=codex, which may spend Codex quota.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const RUNTIME = process.env.LOCUST_RUNTIME ?? 'opencode'
const MODEL = process.env.LOCUST_MODEL ?? (RUNTIME === 'opencode' ? 'opencode/muse-spark-1.3-contributor-free' : 'gpt-6-luna')
const tag = arg('--tag') ?? RUNTIME
const workspace = await scratchRepository(`locust-drive-stop-live-${RUNTIME}-ws-`)
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `stop-a-live-run-${tag}`,
  port: 9854,
  workspace,
  ...(RUNTIME === 'opencode' ? {} : { spends: true }),
  outPath: join(recordRoot('stop-a-live-run-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Custom', roleTitle: 'Notes', createdAt: '2026-10-01T05:00:00.000Z', route: { runtime: RUNTIME, model: MODEL, mode: 'accept-edits', ...(RUNTIME === 'codex' ? { effort: 'low' } : {}) } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const notes = async () => (await readdir(workspace).catch(() => [])).filter((name) => /^note-\d+\.txt$/.test(name)).sort()
const PROMPT = 'Create six files, note-1.txt to note-6.txt, one at a time, each holding a different two-line poem about weather. After writing each file, run this command before the next one, to pace the work: node -e "setTimeout(() => {}, 6000)"'
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openTeammateScript('Wren'))
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`)
  let first = []
  for (let waited = 0; waited < 240_000 && first.length === 0; waited += 1_000) {
    await sleep(1_000)
    first = await notes()
  }
  check('a file landed on disk while the run was going', first.length > 0, first.join(', ') || 'none in 240s')
  const stopped = String(await drive.capture('Stop pressed, part way', () => drive.evaluate(`(async () => {
    const button = document.querySelector('button[aria-label^="Stop the running"]')
    if (!button) return 'no Stop button on screen'
    button.click()
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'stopped after ' + String(i / 2) + 's'
    }
    return 'still running 60s after Stop'
  })()`)))
  check('Stop ends the run', /^stopped after/.test(stopped), stopped)
  const atStop = await notes()
  await sleep(20_000)
  const later = await notes()
  check('nothing lands after the stop (20s later, the same files)', JSON.stringify(atStop) === JSON.stringify(later), `${atStop.join(', ')} -> ${later.join(', ')}`)
  const card = String(await drive.capture('what the conversation says', () => drive.evaluate(`[...document.querySelectorAll('.lc-card.is-standing')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`)))
  check('the card says the person stopped it', /You stopped this run/.test(card), card)
  check('files were written, so it does not claim nothing happened', !/Stopped before it used any tools|nothing was changed/i.test(card) && later.length > 0, card)
  const plan = /(\d+) finished · (\d+) cut off · (\d+) never started \((\d+) steps?\)/.exec(card)
  check('the plan counts add up', plan !== null && Number(plan[1]) + Number(plan[2]) + Number(plan[3]) === Number(plan[4]), card)
  const planRows = await drive.evaluate(`document.querySelectorAll('.lc-plancard li').length`)
  check('the card accounts for every step in the displayed plan', plan !== null && Number(plan[4]) === Number(planRows), `card ${plan?.[4]} / displayed ${planRows}`)
  const finished = card.split('FINISHED')[1]?.split('CUT OFF')[0] ?? ''
  check('Finished excludes the workspace folder', !finished.includes(workspace.split(/[\\/]/).at(-1)), finished)
  if (RUNTIME === 'opencode') {
    check('OpenCode uncertainty is said once', card.split('may have been running when stopped').length - 1 === 1 && !card.includes('may still finish on its own'), card)
  }
  const thread = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  check('no "nothing was changed" anywhere in the conversation', !/nothing was changed/i.test(thread), thread.slice(-400))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on ${RUNTIME} / ${MODEL}, Edit; six files, stopped after the first landed.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
