// Does Stop still stop a Claude run, now that its input stays open (A2.10)?
//
//   LOCUST_SPEND=1 node _tools/drive-claude-stop.mjs [--packaged <exe>] [--tag <label>]
//
// Claude Code runs used to get the prompt on stdin and an end-of-input at
// once. Since A2.10 a Claude run's input stays open until its turn's result,
// so a message can be handed to the running turn. That must not cost the one
// thing a person needs from a run that is going wrong: Stop. Wren (Claude
// Haiku) starts three 8-second commands, Stop is pressed part-way, and the
// run must end promptly, say it was stopped, and the next message must start
// a fresh run that finishes.
//
// SPENDS: two short Claude Haiku turns.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `claude-stop-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends Claude Haiku turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-claude-stop-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'claude-stop',
  port: 9315,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const SLOW = 'Run these three shell commands one at a time, one tool call each, waiting for each: sleep 8 && echo one, then sleep 8 && echo two, then sleep 8 && echo three. Then reply with what they printed, in order.'

try {
  await drive.capture('Wren starts three slow commands; Stop is pressed part-way', async () => {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Wren'))
    await drive.evaluate(sendAndWaitScript(SLOW, { settle: false }))
    await sleep(9000)
    return drive.evaluate(`(async () => {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (!stop) return 'no Stop button: the run was not going'
      const pressed = Date.now()
      stop.click()
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 250))
        if (!document.querySelector('button[aria-label^="Stop the running"]')) {
          await new Promise((r) => setTimeout(r, 800))
          const header = document.querySelector('.lc-workroom__header')?.innerText.split(/\\s+/).join(' ') ?? ''
          return 'ended ' + String(Date.now() - pressed) + ' ms after Stop || header: ' + header.slice(0, 160)
            + ' || thread: ' + (document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-220)
        }
      }
      return 'STILL RUNNING 15 s after Stop'
    })()`)
  })
  await drive.capture('the next message starts a fresh run that finishes', () =>
    drive.evaluate(sendAndWaitScript('Reply with exactly the word PEBBLE.', { waitSeconds: 120 })))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Claude Haiku (Edit). Three 8-second commands, Stop pressed 9 s in; then one more message.`
  })
}
