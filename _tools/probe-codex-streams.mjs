// Does a Codex teammate still behave, now that every mode rides app-server?
//
//   LOCUST_SPEND=1 node _tools/probe-codex-streams.mjs
//
// The transport under a Codex mission changed from `codex exec --json` to
// `codex app-server`, because exec never streams: measured 2026-09-10, its
// JSONL carries the whole agent message in one `item.completed`. The reply
// arriving as deltas is the point, and `probe-stream-settles` measures that.
// This one holds the things that were ALREADY working and must not have
// broken with the transport under them:
//
//   1. A follow-up keeps the earlier turn. `thread/resume` is what carries
//      it; a cold thread would answer the second question with nothing.
//   2. Stop really stops. A run over a protocol ends when the server is
//      killed, not when a pipe closes.
//   3. The receipt still says what the run cost. app-server reports usage in
//      a notification of its own -- `turn/completed` carries none -- so the
//      `40k in / 275 out` line is only there if that notification was read.
//
// SPENDS three small Codex turns on gpt-5.6-luna at low effort. Never Astra.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends three Codex turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

// A control lives here too: the same three checks can be pointed at a runtime
// that never moved transports, which is how "stop is broken" gets told apart
// from "stop is broken BY this change".
const ROUTES = {
  codex: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'accept-edits', effort: 'low' },
  claude: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
}
const which = process.env.LOCUST_RUNTIME ?? 'codex'
const ROUTE = ROUTES[which]
if (ROUTE === undefined) {
  say(`refusing to run: LOCUST_RUNTIME must be one of ${Object.keys(ROUTES).join(', ')}, not "${which}".`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-codexstream-ws-')
const drive = await startDrive({
  name: `codex-streams-${which}`,
  port: 9471,
  workspace,
  spends: true,
  keep: process.env.LOCUST_KEEP === '1',
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: ROUTE
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Type a message and send it. */
const send = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  return true
})()`

/** Wait for the run to end, then read the last reply and the header. */
const settle = `(async () => {
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  const bodies = [...document.querySelectorAll('.lc-agentline__body')]
  return JSON.stringify({
    reply: (bodies.at(-1)?.innerText ?? '').trim().slice(0, 120),
    header: (document.querySelector('.lc-workroom__meta')?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 200)
  }, null, 1)
})()`

const onlyStop = process.env.LOCUST_ONLY_STOP === '1'

try {
  if (onlyStop) {
    await drive.capture('stop ends a run', async () => {
      await drive.ready()
      await drive.evaluate(`${teammateFace('Wren')}?.click()`)
      await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
      await drive.evaluate(send('Count slowly from 1 to 200, one number per line, with a sentence about each.'))
      await drive.evaluate(`new Promise(r => setTimeout(r, 6000))`)
      const pressed = await drive.evaluate(`(() => {
        const stop = document.querySelector('button[aria-label^="Stop the running"]')
        if (stop === null) return false
        stop.click()
        return true
      })()`)
      if (pressed !== true) return 'NOTHING TO STOP: the run was already over'
      const stopped = await drive.evaluate(`(async () => {
        for (let i = 0; i < 60; i += 1) {
          await new Promise(r => setTimeout(r, 500))
          if (!document.querySelector('button[aria-label^="Stop the running"]')) return i * 0.5
        }
        return 'still running after 30s'
      })()`)
      return JSON.stringify({ runtime: which, secondsToStop: stopped }, null, 1)
    })
    await drive.finish({ intro: `Build: whatever \`pnpm build\` last wrote to out/. One teammate on ${ROUTE.runtime} / ${ROUTE.model} in Accept edits, asked for a long answer and then stopped.` })
    process.exit(0)
  }

  await drive.capture('a first turn streams and its receipt says what it cost', async () => {
    await drive.ready()
    await drive.evaluate(`${teammateFace('Wren')}?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    await drive.evaluate(send('Remember the word "gantry". Reply with just: ok'))
    return drive.evaluate(settle)
  })

  // The premise for the follow-up, asserted OUTSIDE capture(): the first turn
  // has to have finished and answered, or the second measures nothing.
  const firstReply = String(await drive.evaluate(`([...document.querySelectorAll('.lc-agentline__body')].at(-1)?.innerText ?? '').trim().slice(0, 40)`))
  if (firstReply.length === 0) throw new Error('NOT THE TEST: the first turn said nothing')

  await drive.capture('a follow-up still has the earlier turn', async () => {
    await drive.evaluate(send('What word did I ask you to remember? Reply with just that word.'))
    const outcome = JSON.parse(String(await drive.evaluate(settle)))
    return JSON.stringify({
      ...outcome,
      keptTheThread: /gantry/i.test(outcome.reply)
    }, null, 1)
  })

  await drive.capture('stop ends a run over the protocol', async () => {
    await drive.evaluate(send('Count slowly from 1 to 200, one number per line, with a sentence about each.'))
    // Let it get going, then press the button a person would press.
    await drive.evaluate(`new Promise(r => setTimeout(r, 6000))`)
    const pressed = await drive.evaluate(`(() => {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop === null) return false
      stop.click()
      return true
    })()`)
    if (pressed !== true) return 'NOTHING TO STOP: the run was already over'
    const stopped = await drive.evaluate(`(async () => {
      for (let i = 0; i < 60; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (!document.querySelector('button[aria-label^="Stop the running"]')) return i * 0.5
      }
      return 'still running after 30s'
    })()`)
    return JSON.stringify({ secondsToStop: stopped }, null, 1)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Codex CLI / gpt-5.6-luna at low effort in Accept edits, now running over `codex app-server` in every mode. Three turns: one to remember a word, one to ask for it back, one long enough to stop.'
  })
}
