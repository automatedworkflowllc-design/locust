// Colin: "Add tests, and a drive on the free OpenCode route that queues a message, relaunches, and checks that it's offered back and nothing was sent."
// Real app and runtime; private profile; an abrupt close through drive-lib.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, FREE_ROW, pickRouteScript, scratchRepository, startDrive, teammateFace, say, sleep } from './drive-lib.mjs'

const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const packaged = arg('--packaged')
const action = arg('--action') ?? 'edit'
if (!['edit', 'send', 'discard'].includes(action)) throw new Error('Use --action edit, send or discard')
const workspace = await scratchRepository('locust-durable-queue-ws-')
const queuedText = 'Reply with QUEUED_REPLY_7391 only. Do not call any tools or edit any files.'
const port = 9609
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-03T12:00:00.000Z', route: FREE_ROUTE }],
  missionOwners: {},
  settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
}
let drive
let failures = 0
let checks = 0
const check = (what, ok, detail = '') => {
  checks++
  if (!ok) failures++
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` — ${detail}` : ''}`)
}
const stateScript = `(() => JSON.stringify({
  queued: document.querySelector('.lc-queued__text')?.textContent ?? null,
  note: document.querySelector('.lc-queued__note')?.textContent ?? null,
  actions: [...document.querySelectorAll('.lc-queued button')].map(b => b.textContent.trim()),
  running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
  box: document.querySelector('textarea[aria-label="Message"]')?.value ?? null,
  thread: document.querySelector('.lc-thread')?.textContent ?? ''
}))()`
const state = async () => JSON.parse(await drive.evaluate(stateScript))
const type = (text, send = true) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Message"]')
  if (!box || box.disabled) throw new Error('Message box unavailable')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 180))
  ${send ? "box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))" : ''}
})()`
async function waitFor(predicate, milliseconds = 60_000) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 250) {
    const seen = await state()
    if (predicate(seen)) return seen
    await sleep(250)
  }
  throw new Error('Timed out waiting for the app state')
}
const history = async () => JSON.parse(await drive.evaluate(`(async () => JSON.stringify(await window.desktop.getMissionHistory()))()`))
try {
  drive = await startDrive({ name: 'durable-queue', port, workspace, seed, keep: true, ...(packaged ? { packaged } : {}) })
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`${teammateFace('Ash')}?.click()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', row: FREE_ROW }))
  const route = String(await drive.evaluate(`document.querySelector('.lc-composer .lc-routechip, button.lc-control')?.textContent ?? document.querySelector('.lc-composer')?.textContent ?? ''`))
  // Inspect the whole composer as well, since the first control can be Mode.
  const composer = String(await drive.evaluate(`document.querySelector('.lc-composer')?.textContent ?? ''`))
  if (!/opencode/i.test(composer) || !/free/i.test(composer)) throw new Error(`Refusing a non-free route: ${route} ${composer}`)
  check('The composer is on the free OpenCode route.', true, FREE_ROUTE.model)
  await drive.capture('a free turn running', async () => {
    await drive.evaluate(type('Count from 1 to 5000, one number per line. Do not call tools, write files or delegate. Start counting in your reply.'))
    return JSON.stringify(await waitFor(s => s.running))
  })
  await drive.capture('the next message queued behind Ash', async () => {
    await drive.evaluate(type(queuedText))
    return JSON.stringify(await waitFor(s => s.queued === queuedText))
  })
  const before = await state()
  check('The message is queued while Ash is running.', before.running && before.queued === queuedText)
  const saved = JSON.parse(await drive.evaluate(`(async () => JSON.stringify(await window.desktop.readQueuedMessages()))()`))
  check('The host has acknowledged the exact queued words on disk.', saved.ok && saved.rows.some(r => r.text === queuedText))
  const baseline = await history()
  if (!baseline.ok) throw new Error('History unavailable before close')
  const handoff = await drive.finish({ intro: 'A real free OpenCode turn; message queued; abrupt close.', last: false })
  drive = undefined
  drive = await startDrive({ name: 'durable-queue', port, workspace, profilePath: handoff.profile, outPath: handoff.out, stepFrom: handoff.step, keep: true, ...(packaged ? { packaged } : {}) })
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.capture('the saved queue offered after relaunch', async () => {
    // Reopen the actual conversation row, rather than Ash's empty home screen.
    await drive.evaluate(`document.querySelector('.lc-conv')?.click()`)
    return JSON.stringify(await waitFor(s => s.queued === queuedText))
  })
  const restored = await state()
  check('The original words are offered in the conversation queue.', restored.queued === queuedText)
  check('The queue says that Send is required after closing.', /saved before Locust closed.*press Send/i.test(restored.note ?? ''))
  check('Edit, Discard and Send are offered.', ['Edit', 'Discard', 'Send now'].every(a => restored.actions.includes(a)))
  await drive.capture('left alone after reopen, nothing sent', async () => { await sleep(8000); return JSON.stringify(await state()) })
  const after = await history()
  const held = await state()
  check('Reopening started no run and sent no queued message.', !held.running && after.ok && after.data.missions.length === baseline.data.missions.length && !after.data.missions.some(m => m.prompt.includes('QUEUED_REPLY_7391')))
  check('Waiting still leaves the message held.', held.queued === queuedText)
  if (action === 'edit') {
  await drive.capture('Edit returns the saved words to the box', async () => {
    await drive.evaluate(`[...document.querySelectorAll('.lc-queued button')].find(b => b.textContent.trim() === 'Edit')?.click()`)
    return JSON.stringify(await waitFor(s => s.queued === null && s.box === queuedText))
  })
  check('Edit returns the words without sending them.', (await state()).box === queuedText && !(await state()).running)
  const removed = JSON.parse(await drive.evaluate(`(async () => JSON.stringify(await window.desktop.readQueuedMessages()))()`))
  check('Edit removed only the saved queue entry.', removed.ok && removed.rows.length === 0)
  } else if (action === 'discard') {
    await drive.capture('Discard removes the saved message without sending', async () => {
      await drive.evaluate(`[...document.querySelectorAll('.lc-queued button')].find(b => b.textContent.trim() === 'Discard')?.click()`)
      return JSON.stringify(await waitFor(s => s.queued === null))
    })
    const removed = JSON.parse(await drive.evaluate(`(async () => JSON.stringify(await window.desktop.readQueuedMessages()))()`))
    check('Discard removes the message from the host store.', removed.ok && removed.rows.length === 0)
    check('Discard starts no run.', !(await state()).running && (await history()).data.missions.length === baseline.data.missions.length)
  } else {
    // Reopening can offer the queue before runtime discovery has settled.
    // Wait for the actual free route before explicitly sending any words.
    for (let elapsed = 0; elapsed < 120_000; elapsed += 500) {
      const composer = String(await drive.evaluate(`document.querySelector('.lc-composer')?.textContent ?? ''`))
      if (/opencode/i.test(composer) && /free/i.test(composer)) break
      await sleep(500)
    }
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', row: FREE_ROW }))
    const composer = String(await drive.evaluate(`document.querySelector('.lc-composer')?.textContent ?? ''`))
    if (!/opencode/i.test(composer) || !/free/i.test(composer)) throw new Error('Free route unavailable after relaunch; nothing sent')
    await drive.capture('the person explicitly sends the restored message', async () => {
      await drive.evaluate(`[...document.querySelectorAll('.lc-queued button')].find(b => b.textContent.trim() === 'Send now')?.click()`)
      return JSON.stringify(await waitFor(s => s.running || (s.queued === null && s.thread.includes('QUEUED_REPLY_7391'))))
    })
    const sentHistory = await history()
    check('An explicit Send records exactly one queued prompt.', sentHistory.ok && sentHistory.data.missions.filter(m => m.prompt.includes('QUEUED_REPLY_7391')).length === 1)
    const removed = JSON.parse(await drive.evaluate(`(async () => JSON.stringify(await window.desktop.readQueuedMessages()))()`))
    check('Send removed the saved queue from disk.', removed.ok && removed.rows.length === 0)
    await drive.capture('the explicit free turn settles', async () => JSON.stringify(await waitFor(s => !s.running && s.thread.includes('QUEUED_REPLY_7391'), 180_000)))
  }
  check('The renderer reported no errors.', drive.record.every(r => r.errors.length === 0))
} catch (error) {
  check('The complete relaunch drive finishes.', false, error instanceof Error ? error.message : String(error))
} finally {
  if (drive) {
    await writeFile(join(drive.out, 'RESULT.json'), JSON.stringify({ checks, passed: checks - failures, failures }, null, 2))
    await drive.finish({ intro: `Saved queue held after relaunch, with an explicit ${action}.`, extra: `${checks - failures}/${checks} checks passed.` })
  }
}
say(`DURABLE QUEUE: ${checks - failures}/${checks} checks passed; ${failures} failed`)
process.exitCode = failures === 0 ? 0 : 1
