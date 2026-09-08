// A person turns a conversation into a routine that runs every few hours,
// closes Locust, opens it later, and finds the routine has run by itself.
//
//   node _tools/drive-routine.mjs
//
// Wren on the free OpenCode model. One message, "Save as routine" from the
// conversation's row menu, "Every few hours", the Team screen. Then the app
// is closed, the routine back-dated five hours on disk (the stand-in for
// waiting), and the app opened again on the same profile with nothing
// pressed. Kept: the dialog, the Team card, the sidebar when the run starts
// by itself, and the card afterwards.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-routine-ws-')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', worktree: true, createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
}
let drive = await startDrive({ name: 'routine', port: 9297, workspace, seed, keep: true })
let handoff

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('one message to Wren, and its reply', () => drive.evaluate(`(async () => {
    const who = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))
    who.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word ALPHA and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'finished: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-120) ?? '')
    }
    return 'still running'
  })()`))
  await drive.capture('right-click the conversation: the row menu', () => drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-teammate__mission')
    if (!row) return 'no conversation row'
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 260 }))
    await new Promise(r => setTimeout(r, 400))
    return 'menu: ' + [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].map(b => b.innerText.trim()).join(' / ')
  })()`))
  await drive.capture('Save as routine: the dialog', () => drive.evaluate(`(async () => {
    const item = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find(b => /Save as routine/.test(b.innerText))
    if (!item) return 'no menu item'
    item.click()
    await new Promise(r => setTimeout(r, 500))
    const dialog = document.querySelector('[role=dialog][aria-label="Save as routine"]')
    return dialog ? 'dialog: ' + dialog.innerText.replace(/\\s+/g, ' ').slice(0, 220) : 'dialog did not open'
  })()`))
  await drive.capture('choose Every few hours', () => drive.evaluate(`(async () => {
    const dialog = document.querySelector('[role=dialog][aria-label="Save as routine"]')
    const every = [...dialog.querySelectorAll('[role=radio]')].find(b => /Every few hours/.test(b.innerText))
    if (!every) return 'no schedule choice'
    every.click()
    await new Promise(r => setTimeout(r, 300))
    const pick = dialog.querySelector('select[aria-label="Hours between runs"]')
    return 'hours: ' + (pick ? pick.value : 'no control') + ' · ' + ([...dialog.querySelectorAll('p')].map(p => p.innerText).find(t => /Only while Locust is open/.test(t)) ?? 'no note')
  })()`))
  await drive.capture('Save routine, then the Team screen', () => drive.evaluate(`(async () => {
    const dialog = document.querySelector('[role=dialog][aria-label="Save as routine"]')
    const save = [...dialog.querySelectorAll('button')].find(b => b.innerText.trim() === 'Save routine')
    if (!save || save.disabled) return 'save disabled'
    save.click()
    await new Promise(r => setTimeout(r, 800))
    document.querySelector('button[title="Team (Ctrl 2)"]').click()
    await new Promise(r => setTimeout(r, 700))
    return [...document.querySelectorAll('.lc-routinerow')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
  })()`))
  handoff = await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on the free OpenCode model. A conversation saved as a routine that runs every few hours.', last: false })

  // The wait, stood in for: back-date the routine five hours on disk.
  const routinesPath = join(handoff.profile, 'routines.json')
  const file = JSON.parse(await readFile(routinesPath, 'utf8'))
  const routine = file.routines?.[0]
  if (routine === undefined) throw new Error('no routine on disk')
  file.routines[0] = { ...routine, createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString() }
  await writeFile(routinesPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  await sleep(1500)

  drive = await startDrive({ name: 'routine', port: 9297, workspace, profilePath: handoff.profile, outPath: handoff.out, stepFrom: handoff.step })
  await drive.capture('reopened five hours later: nothing pressed', () => drive.ready())
  await drive.capture('the sidebar while a routine runs on a teammate with a branch', () => drive.evaluate(`(async () => {
    // The routine step and the worktree branch answer the same question --
    // where and how is this teammate working right now -- and the row used to
    // draw BOTH, which is what stacked five lines in a 268px rail (design
    // review, 2026-09-06). While a routine runs the step wins, because it is
    // the thing that is changing.
    // Wait for the routine to actually be running: read too early and the
    // teammate is idle, the step has not appeared, and the drive measures the
    // uninteresting case.
    let text = ''
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const found = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
      text = found?.innerText ?? ''
      if (/routine · step/.test(text)) break
    }
    const lines = text.split(String.fromCharCode(10)).map(t => t.trim()).filter(t => t.length > 0)
    return 'lines: ' + lines.length
      + ' || routine step shown: ' + /routine · step/.test(text)
      + ' || branch shown: ' + /on locust\\//.test(text)
      + ' || [' + lines.join(' / ') + ']'
  })()`))

  await drive.capture('the routine starts a run by itself', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const wren = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
      if (wren && /working|running|starting|replying/i.test(wren.innerText)) return 'sidebar: ' + wren.innerText.replace(/\\s+/g, ' ').slice(0, 160)
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'a run is live: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 160)
    }
    return 'nothing started in two minutes: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 160)
  })()`))
  await drive.capture('open that run: who started it', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-teammate__mission')][0]
    if (row) row.click()
    await new Promise(r => setTimeout(r, 800))
    return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no header')
  })()`))
  await drive.capture('let it finish, then the Team card', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    document.querySelector('button[title="Team (Ctrl 2)"]').click()
    await new Promise(r => setTimeout(r, 700))
    return [...document.querySelectorAll('.lc-routinerow')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'closed, back-dated five hours, reopened on the same profile', last: true })
  const { rm } = await import('node:fs/promises')
  if (handoff !== undefined) await rm(handoff.profile, { recursive: true, force: true }).catch(() => undefined)
}
