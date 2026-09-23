// A cold-start send, deliberately without drive.ready(): that wait closes the
// exact discovery window this regression lives in. Only OpenCode free runs.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeFile } from 'node:fs/promises'
import { teammateFace } from './drive-lib.mjs'

process.env.LOCUST_SCRATCH = join(homedir(), 'Documents', 'locust-route-start-scratch-20260910')
const { scratchRepository, startDrive, FREE_ROUTE } = await import('./drive-lib.mjs')
const hostBoundary = process.argv.includes('--host-boundary')

function checkEarly(sample) {
  assert.equal(sample?.sent, true, 'no send is not a successful early-send test')
  assert.ok(Number.isInteger(sample.before) && Number.isInteger(sample.after), 'discovery counts missing')
  assert.ok(sample.after > sample.before, 'discovery did not advance after send; early window unmeasured')
  assert.equal(sample.mission?.runtime, FREE_ROUTE.runtime)
  assert.equal(sample.mission?.model, FREE_ROUTE.model)
  assert.equal(sample.mission.phase, 'completed', 'a start receipt alone does not prove the runtime ran')
  assert.ok(sample.mission.events?.some(event => event.type === 'run.completed'), 'no terminal runtime evidence')
}
// Prove the judge rejects no data, a settled send, and the wrong runtime.
const control = { sent: true, before: 4, after: 6, mission: { ...FREE_ROUTE, phase: 'completed', events: [{ type: 'run.completed' }] } }
checkEarly(control)
assert.throws(() => checkEarly(undefined))
assert.throws(() => checkEarly({ ...control, after: 4 }))
assert.throws(() => checkEarly({ ...control, mission: { ...FREE_ROUTE, runtime: 'codex' } }))
assert.throws(() => checkEarly({ ...control, mission: FREE_ROUTE }))

const workspace = await scratchRepository('locust-route-start-', 'Scratch route verification. Follow the user prompt; do not edit files.\n')
const drive = await startDrive({
  name: hostBoundary ? 'route-at-start-host-boundary' : 'route-at-start', port: 9496, workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-10T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
const results = { controls: 'clean accepted; no-data, settled-send and wrong-runtime rejected' }
try {
  results.early = await drive.evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const count = () => {
      const match = document.body.innerText.match(/(\\d+) runtimes? connected/)
      return match ? Number(match[1]) : null
    }
    let teammate
    for (let i = 0; i < 600; i++) {
      teammate = ${teammateFace('Wren')}
      if (teammate && document.querySelector('form.command-dock textarea')) break
      await sleep(25)
    }
    if (!teammate) return { sent: false, reason: 'no teammate' }
    teammate.click()
    await sleep(25)
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Reply with ROUTE_OK. Do not use tools or edit files.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    let sent = false, before, chip, startResponse
    if (${hostBoundary}) {
      // Inject the stale request at the actual preload/host boundary. This
      // is not a user click: OpenCode becomes ready too late on this box to
      // measure the original click race. Antigravity + Ask makes the mutant
      // refuse safely rather than accidentally spending a paid account.
      before = count()
      if (before === null && field.placeholder === 'Checking local runtimes…') before = 0
      chip = document.querySelector('form.command-dock')?.innerText
      sent = true
      startResponse = await window.desktop.startCodexMission({
        prompt: 'Reply with ROUTE_OK. Do not use tools or edit files.',
        mode: 'ask', runtime: 'antigravity', model: 'account-default', teammateId: 'tm_wren'
      })
    }
    for (let i = 0; i < 600 && !sent; i++) {
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) {
        before = count()
        chip = document.querySelector('form.command-dock')?.innerText
        button.click(); sent = true; break
      }
      await sleep(25)
    }
    const samples = []
    let mission
    for (let i = 0; i < 90; i++) {
      await sleep(500)
      samples.push(count())
      const history = await window.desktop.getMissionHistory()
      mission = history.ok ? history.data.missions[0] : undefined
      if (i > 12 && mission?.events.some(e => e.type === 'run.completed' || e.type === 'run.failed')) break
    }
    return { sent, before, after: Math.max(...samples.filter(x => x !== null)), chip, samples, mission, startResponse,
      thread: document.querySelector('.lc-thread')?.innerText }
  })()`)
  await drive.capture('cold start send before discovery settles', () => JSON.stringify(results.early))
  // These refusals are safe even on the OLD host: Antigravity cannot run Ask.
  // They prove that neither an explicit override nor home is forced onto Wren.
  const refusal = { prompt: 'Do not run.', mode: 'ask', runtime: 'antigravity', model: 'account-default' }
  results.explicit = await drive.evaluate(`window.desktop.startCodexMission(${JSON.stringify({ ...refusal, teammateId: 'tm_wren', routeOverrideFor: 'tm_wren' })})`)
  results.nobody = await drive.evaluate(`window.desktop.startCodexMission(${JSON.stringify(refusal)})`)
  for (const answer of [results.explicit, results.nobody]) {
    assert.equal(answer?.ok, false)
    assert.match(answer.error.message, /Antigravity.*cannot hold it read-only/)
  }
  checkEarly(results.early)
  results.verdict = 'PASS'
} catch (error) {
  results.verdict = 'FAIL / UNMEASURED'
  results.error = String(error)
  process.exitCode = 1
} finally {
  await writeFile(join(drive.out, 'route-results.json'), JSON.stringify(results, null, 2))
  await drive.finish({ intro: 'Real Electron, isolated scratch/profile, OpenCode free only. No ready() settling wait. Controls run before launch. Host boundary injection: ' + hostBoundary, extra: JSON.stringify({ verdict: results.verdict, error: results.error }) })
  console.log(JSON.stringify(results, null, 2))
}
