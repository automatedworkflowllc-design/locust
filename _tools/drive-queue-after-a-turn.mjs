// Does a message queued behind a turn go when that turn ends?
//
//   node _tools/drive-queue-after-a-turn.mjs [--packaged <exe>] [--tag <name>] [--model <words>] [--pad <files>]
//
// drive-long-conversation on the packaged 0.297 (2026-09-23): turn 5 was
// queued behind turn 4, turn 4 ended, and turn 5 never ran -- the window fell
// back to the teammate's home screen and the next message started a second
// conversation. The window sends a queued message the moment it sees the run
// in front end; the host was still winding that run down (it looks at the
// disk after every run -- `git status` and every untracked file read) and
// refused the next turn as "already has a mission running", and the queue
// had nothing left to wait behind.
//
// So the workspace here carries a few thousand untracked files, which is
// what makes that look at the disk take long enough to be hit every time:
// one turn is sent, a second is queued behind it, and the drive checks the
// second one actually ran -- its file on disk, its answer in the thread, the
// conversation still on screen, one row in the sidebar. Free model; spends
// nothing.

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const MODEL = arg('--model') ?? 'lightning'
const PAD = Number(arg('--pad') ?? '3000')
const OUT = join(recordRoot('beta-fixes-2026-09-23'), `queue-after-a-turn-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-queue-ws-')
await mkdir(join(workspace, 'pad'), { recursive: true })
for (let index = 0; index < PAD; index += 1) {
  await writeFile(join(workspace, 'pad', `f${String(index).padStart(5, '0')}.txt`), `untracked file ${String(index)}\n`, 'utf8')
}
say(`workspace ${workspace} with ${String(PAD)} untracked files`)

const drive = await startDrive({
  name: `queue-after-a-turn-${tag}`,
  port: 9437,
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const type = (text) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Mission instruction"]')
  if (!box) return 'no box'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 250))
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'sent'
})()`

const STATE = `(() => JSON.stringify({
  running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
  queued: document.querySelector('.lc-queued') !== null,
  thread: document.querySelector('.lc-thread') !== null,
  said: [...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((node) => node.textContent.trim()).join(' | ').slice(-200),
  rows: document.querySelectorAll('.lc-conv').length
}))()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 900)) })()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: MODEL, row: `/${MODEL}/i` }))
  const route = String(await drive.evaluate(`(() => {
    const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
    return (c?.textContent ?? '').trim()
  })()`))
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`route is ${JSON.stringify(route)} -- refusing anything but a free OpenCode model`)
  say(`route: ${route}`)

  await drive.capture('the first turn sent', () => drive.evaluate(type('Create notes/a.txt containing the word ALPHA. Then say ONE.')))
  // Queue the second once the first is under way.
  const queuedBehind = await drive.capture('the second turn typed while the first runs', async () => {
    for (let waited = 0; waited < 60_000; waited += 500) {
      const state = JSON.parse(await drive.evaluate(STATE))
      if (state.running) break
      await new Promise((r) => setTimeout(r, 500))
    }
    await drive.evaluate(type('Create notes/b.txt containing the word BRAVO. Then say TWO.'))
    await new Promise((r) => setTimeout(r, 800))
    return drive.evaluate(STATE)
  })
  const queued = JSON.parse(String(queuedBehind))
  check('the second turn waits behind the first', queued.queued === true && queued.running === true, String(queuedBehind))

  const settled = await drive.capture('both turns, settled', async () => {
    let last = ''
    for (let waited = 0; waited < 360_000; waited += 1000) {
      last = await drive.evaluate(STATE)
      const state = JSON.parse(last)
      if (!state.running && !state.queued && waited > 5000) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    await new Promise((r) => setTimeout(r, 1500))
    return drive.evaluate(STATE)
  })
  const end = JSON.parse(String(settled))
  const ranFile = existsSync(join(workspace, 'notes', 'b.txt'))
  say(`end: ${String(settled)}; notes/b.txt ${ranFile ? 'exists' : 'does not exist'}`)
  check('the second turn ran: its file is on disk', ranFile)
  check('and its answer is in the thread', /\bTWO\b/.test(end.said ?? ''), end.said)
  check('the conversation is still on screen', end.thread === true)
  check('one conversation in the sidebar, not a second one started', end.rows === 1, String(end.rows))
  say(failures === 0 ? '\nQUEUE AFTER A TURN PASSED' : `\nQUEUE AFTER A TURN: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One turn sent and a second queued behind it, in a workspace with thousands of untracked files. Free model; nothing was spent.' })
}
