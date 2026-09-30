// A command's row shows what it printed (0.489), on a real Claude run.
//
//   LOCUST_SPEND=1 node _tools/drive-steps-show-output.mjs [--packaged <exe>]
//
// Colin, 2026-09-30: "make sure our outputs are matching the claude code/codex
// apps". Claude's tool results were never carried, so a command's row had
// nothing to open onto (docs/DISPLAY-COVERAGE-2026-09-30.md, gap 5). A teammate
// on Claude Haiku runs `node -e "console.log(6*7*1000+1)"`; its output, 42001,
// is in no prompt, so finding it in the record and on the opened row proves it
// came through the adapter and onto the screen. An adapter change gets a real
// run (memory: 0.407). Spends one Haiku turn.

import { openTeammateScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await scratchRepository('locust-drive-output-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'steps-show-output', port: 9771, workspace, spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'auto' } }],
    missionOwners: {},
    // Auto, so the drive never waits on a person's approval (Colin clicked one, 2026-09-30).
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
  await drive.evaluate(openTeammateScript('Ash'))
  const sent = await drive.evaluate(sendAndWaitScript('Run this exact shell command and nothing else: node -e "console.log(6*7*1000+1)" -- then reply with the single word DONE.'))
  say(`  sent: ${String(sent).slice(0, 120)}`)
  await sleep(1500)
  const recorded = JSON.parse(String(await drive.evaluate(`(async () => {
    const history = await window.desktop.getMissionHistory()
    const mission = history.ok ? history.data.missions.at(-1) : undefined
    const events = mission?.events ?? []
    const done = events.filter((e) => e.type === 'tool.completed' || e.type === 'tool.failed').map((e) => ({ name: e.payload.name, output: String(e.payload.output ?? '').slice(0, 80) }))
    return JSON.stringify({ phase: mission?.phase, done })
  })()`)))
  say(`  record: ${JSON.stringify(recorded)}`)
  check('the run finished', recorded.phase === 'completed', String(recorded.phase))
  check("the command's output is in the record", recorded.done.some((call) => /42001/.test(call.output)), JSON.stringify(recorded.done))
  const shown = String(await drive.capture('the command row, opened', () => drive.evaluate(`(async () => {
    // Two levels: the activity card, then the command row inside it.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const button of [...document.querySelectorAll('.lc-thread button[aria-expanded="false"]')]) {
        // Every closed row: a command's row leads with Claude's own
        // description of it ("Run the node calculation"), not the command.
        button.click()
      }
      await new Promise((r) => setTimeout(r, 600))
    }
    return document.querySelector('.lc-thread')?.innerText ?? ''
  })()`)))
  // The prompt says 6*7*1000+1, never 42001: only the output can put it here.
  check('and on the screen, under its command', /42001/.test(shown), shown.slice(shown.indexOf('node -e'), shown.indexOf('node -e') + 160))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, one command.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
