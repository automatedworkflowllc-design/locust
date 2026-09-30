// A turn reads as it happens, and nothing moves when it ends (0.491).
//
//   LOCUST_SPEND=1 node _tools/drive-a-turn-reads-as-it-happens.mjs [--packaged <exe>] [--tag <name>]
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
const workspace = await scratchRepository('locust-drive-reads-as-it-happens-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-turn-reads-as-it-happens-${tag}`, port: 9797, workspace, spends: true,
  outPath: join(recordRoot('a-turn-reads-as-it-happens-2026-09-30'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'auto' } }],
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
    : el.classList.contains('lc-livestep') ? 'LIVE'
    : el.querySelector('.lc-steps__line') ? 'STEPS ' + el.querySelector('.lc-steps__line').innerText.replace(/\\s+/g, ' ').trim()
    : 'SAID ' + el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 50))
  .filter((line) => line !== 'SAID '))()`

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
  const live = samples.filter((sample) => sample.includes('LIVE'))
  const both = live.find((sample) => sample.some((line) => line.startsWith('STEPS')) && sample.some((line) => line.startsWith('SAID')))
  check('while it worked, its steps were lines among what it said', both !== undefined, JSON.stringify(live.at(-1) ?? []).slice(0, 240))
  const saidFinal = final.filter((line) => line.startsWith('SAID'))
  const stepsFinal = final.filter((line) => line.startsWith('STEPS'))
  // A thought before the first sentence is its own line, and right: it happened first.
  const work = final.filter((line) => !/^STEPS Thought( for|$)/.test(line))
  check('the finished turn reads said, steps, said, steps ...', stepsFinal.length >= 2 && saidFinal.length >= 3 && work[0]?.startsWith('SAID') === true, JSON.stringify(final).slice(0, 300))
  // Nothing moved: what was said, in the order it was drawn live, is the order it ends in.
  const lastLive = (live.at(-1) ?? []).filter((line) => line.startsWith('SAID')).map((line) => line.slice(0, 30))
  const finalSaid = saidFinal.map((line) => line.slice(0, 30))
  check('nothing moved when it ended: the live order of what was said is the final order', lastLive.every((line, index) => finalSaid[index] === line), JSON.stringify({ lastLive, finalSaid }))
  check('the finished turn has its foot', final.at(-1) === 'FOOT' || final.includes('FOOT'), JSON.stringify(final.slice(-3)))
  await drive.capture('a group opened', () => drive.evaluate(`(async () => { document.querySelectorAll('.lc-thread .lc-steps__line')[1]?.click(); await new Promise((r) => setTimeout(r, 500)); return document.querySelector('.lc-thread .lc-steps__list')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'none' })()`))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, three narrated steps, sampled while it ran.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
