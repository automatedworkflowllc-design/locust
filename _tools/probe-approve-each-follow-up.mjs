// Does a reply in Approve-each remember the turn before it?
//
//   LOCUST_SPEND=1 node _tools/probe-approve-each-follow-up.mjs
//
// Approve-each is the one Codex mode still running on its own mission
// service (`app-server-mission.ts`), because it was the only mode that
// needed a runtime able to stop and ask. Since 0.65.0 every OTHER Codex mode
// runs on the shared path, which resumes a thread on a follow-up and was
// driven doing it -- a second turn answered with a word from the first.
//
// That file contains no `followUpOf`, no `resumeThreadId`, no
// `thread/resume` and no `continuesFrom`: it calls `thread/start` every
// time. So a reply in Approve-each should be COLD -- the thread on screen
// shows the earlier turn, the model has never seen it. This checks whether
// that reading of the code is what a person actually gets, because a reading
// is not a measurement.
//
// The prompts need no tools, so no approval card is expected; if one appears
// the probe says so rather than hanging.
//
// SPENDS two Codex turns on gpt-5.6-luna at low effort. Never Astra.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two Codex turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-approvefollow-ws-')
const drive = await startDrive({
  name: 'approve-each-follow-up',
  port: 9483,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'approve-each', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const send = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  return true
})()`

// Wait for the turn to end, approving anything that asks so a card cannot
// stall the run. Nothing here should need a tool.
const settle = `(async () => {
  let approvals = 0
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const card = document.querySelector('[aria-label="Approval required"]')
    if (card !== null) {
      const yes = [...card.querySelectorAll('.lc-approval__actions button')].find(b => /approve/i.test(b.innerText))
      if (yes !== undefined) { yes.click(); approvals += 1 }
    }
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  const bodies = [...document.querySelectorAll('.lc-agentline__body')]
  return JSON.stringify({
    approvalsSeen: approvals,
    reply: (bodies.at(-1)?.innerText ?? '').trim().slice(0, 140)
  }, null, 1)
})()`

try {
  await drive.capture('turn one: give it a word to remember', async () => {
    await drive.ready()
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    await drive.evaluate(send('Remember the word "gantry". Reply with just: ok'))
    return drive.evaluate(settle)
  })

  // The premise, asserted OUTSIDE capture(): turn one has to have answered.
  const first = String(await drive.evaluate(`([...document.querySelectorAll('.lc-agentline__body')].at(-1)?.innerText ?? '').trim().slice(0, 40)`))
  if (first.length === 0) throw new Error('NOT THE TEST: the first turn said nothing')

  await drive.capture('turn two: ask for it back', async () => {
    await drive.evaluate(send('What word did I ask you to remember? Reply with just that word, or exactly: I WAS NOT TOLD'))
    const outcome = JSON.parse(String(await drive.evaluate(settle)))
    return JSON.stringify({
      ...outcome,
      keptTheThread: /gantry/i.test(outcome.reply)
    }, null, 1)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Codex CLI / gpt-5.6-luna in APPROVE-EACH, which is the one mode still on its own mission service. Two turns of one conversation; the second asks for a word from the first. `keptTheThread` is the answer.'
  })
}
