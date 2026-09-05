// A room's task board, used: a task typed by hand, assigned, moved by a
// teammate's reply, and closed by the person.
//
//   node _tools/drive-board.mjs
//
// Two teammates on the free OpenCode model, read-only. The room is made
// through the form; two tasks are added by hand; one is assigned to Wren
// from the board; a post asks everyone to mark their task done with the
// task block they were shown; the person presses Done on the other.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-board-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  name: 'board',
  port: 9305,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
const board = `JSON.stringify({
  count: document.querySelector('.lc-board__count')?.innerText ?? '',
  tasks: [...document.querySelectorAll('.lc-task')].map(t => (t.querySelector('.lc-task__state')?.textContent.trim() ?? '') + ' · ' + (t.querySelector('.lc-task__text')?.innerText ?? '') + ' · ' + (t.querySelector('.lc-task__owner')?.innerText.replace(/\\s+/g, ' ').trim() ?? '')),
  cards: [...document.querySelectorAll('.lc-roomanswer')].map(c => (c.querySelector('.lc-roomanswer__name')?.textContent.trim() ?? '') + ' · ' + (c.querySelector('.lc-roomanswer__phase')?.textContent.trim() ?? ''))
})`
const addTask = (text) => `(async () => {
  const box = document.querySelector('input[aria-label="Add a task"]')
  if (!box) return 'no add field'
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(box, ${JSON.stringify(text)}); box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  const add = [...document.querySelectorAll('.lc-board__add button, .lc-board button')].find(b => b.innerText.trim() === 'Add')
  if (add) add.click(); else box.form?.requestSubmit()
  await new Promise(r => setTimeout(r, 600))
  return ${board}
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('make the room Release with both teammates', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const input = document.querySelector('input[aria-label="Room name"]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Release'); input.dispatchEvent(new Event('input', { bubbles: true }))
    for (const m of document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')) if (m.getAttribute('aria-checked') !== 'true') m.click()
    await new Promise(r => setTimeout(r, 200))
    ;[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room').click()
    await new Promise(r => setTimeout(r, 900))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' || ' + ${board}
  })()`))
  await drive.capture('add a task by hand: Write the release notes', () => drive.evaluate(addTask('Write the release notes')))
  await drive.capture('add another: Check the version string', () => drive.evaluate(addTask('Check the version string')))
  await drive.capture('assign the first to Wren from the board', () => drive.evaluate(`(async () => {
    const task = [...document.querySelectorAll('.lc-task')].find(t => /release notes/.test(t.innerText))
    if (!task) return 'no task'
    const assign = [...task.querySelectorAll('button')].find(b => /Assign/i.test(b.innerText))
    if (!assign) return 'no Assign button: ' + [...task.querySelectorAll('button')].map(b => b.innerText.trim()).join('/')
    assign.click()
    await new Promise(r => setTimeout(r, 400))
    const wren = [...task.querySelectorAll('[role=group][aria-label="Assign to"] button')].find(b => b.innerText.trim() === 'Wren')
    if (!wren) return 'no Wren choice: ' + [...task.querySelectorAll('button')].map(b => b.innerText.trim()).join('/')
    wren.click()
    await new Promise(r => setTimeout(r, 700))
    return ${board}
  })()`))
  await drive.capture('post: everyone marks their task done with the task block', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Wren: using the task block you were shown, mark the task "Write the release notes" done, then reply with the single word DONE. Booty: reply with the single word READY and do nothing else.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      if (i > 6 && phases.length >= 2 && phases.every(p => /completed|failed|cancelled/.test(p))) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return ${board}
  })()`))
  await drive.capture('press Done on the other task, by hand', () => drive.evaluate(`(async () => {
    const task = [...document.querySelectorAll('.lc-task')].find(t => /version string/.test(t.innerText))
    const done = task && [...task.querySelectorAll('button')].find(b => b.innerText.trim() === 'Done')
    if (!done) return 'no Done: ' + (task ? [...task.querySelectorAll('button')].map(b => b.innerText.trim()).join('/') : 'no task')
    done.click()
    await new Promise(r => setTimeout(r, 700))
    return ${board}
  })()`))
  await drive.capture('Open on the moved task goes to the reply that moved it', () => drive.evaluate(`(async () => {
    const task = [...document.querySelectorAll('.lc-task')].find(t => /release notes/.test(t.innerText))
    const open = task && [...task.querySelectorAll('button')].find(b => b.innerText.trim() === 'Open')
    if (!open) return 'no Open on the task'
    open.click()
    await new Promise(r => setTimeout(r, 800))
    return document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no workroom'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren and Booty on the free OpenCode model, read-only. A room, two tasks by hand, one assigned, one moved by a reply, one closed by the person.' })
}
