// Stop an OpenCode run while its command is running and not yet reported (0.536).
// Colin: "Card only (Fix plan counts and workspace filtering; show that an
// unreported OpenCode command may have been running, with one warning.)."
//
//   node _tools/drive-stop-before-a-tool-reports.mjs [--packaged <exe>] [--tag <name>]
//
// Sol's 0.532 Workflow 3: a free OpenCode teammate's Node timer was running
// (its PID seen) when Stop was pressed, and the card said "Stopped before it
// used any tools" and "No tool had run, so sending it again cannot repeat
// anything". OpenCode reports a tool only once it has finished. Here the
// command writes started.txt the moment it begins, then waits 90 seconds;
// Stop is pressed once that file exists. The card must not promise nothing
// ran. Free OpenCode: spends nothing.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/muse-spark-1.3-contributor-free'
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-stop-early-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `stop-early-${tag}`,
  port: 9858,
  workspace,
  outPath: join(recordRoot('stop-before-a-tool-reports-2026-10-02'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Custom', roleTitle: 'Notes', createdAt: '2026-10-01T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const started = async () => (await readdir(workspace).catch(() => [])).includes('started.txt')
const PROMPT = 'Run exactly this command first, and wait for it to finish before doing anything else: node -e "require(\'fs\').writeFileSync(\'started.txt\', \'1\'); setTimeout(() => {}, 90000)"'
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
  let running = false
  for (let waited = 0; waited < 240_000 && !running; waited += 1_000) {
    await sleep(1_000)
    running = await started()
  }
  check('the command began (started.txt is on disk)', running)
  const stopped = String(await drive.capture('Stop pressed while the command runs', () => drive.evaluate(`(async () => {
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
  await sleep(2_000)
  const thread = String(await drive.capture('what the conversation says', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`)))
  check('it does not promise no tool ran', !/Stopped before it used any tools/.test(thread) && !/cannot repeat anything/.test(thread), thread.slice(-500))
  check('Cut off names the unreported OpenCode command as uncertain', /CUT OFF.*An unreported OpenCode command may have been running when stopped\./.test(thread), thread.slice(-700))
  check('the warning is said once', thread.split('may have been running when stopped').length - 1 === 1 && !thread.includes('may still finish on its own'), thread.slice(-700))
  check('it never says no tool call was open', !/No tool call was open/.test(thread), thread.slice(-500))
  // Send again is offered only when nothing at all was reported; then it says to look first.
  check('if it offers Send again, it says to look at the folder first', !/Send again/.test(thread) || /Look at the folder before sending it again/.test(thread), thread.slice(-500))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on opencode / ${MODEL}, Edit; stopped while a 90s command ran.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
