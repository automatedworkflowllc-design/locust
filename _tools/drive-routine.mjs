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

import { conversationRows, FREE_ROUTE, say, scratchRepository, sleep, startDrive, teammateRows } from './drive-lib.mjs'

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
    // STEP 2 THREW HERE, and every later step then tested an empty list.
    // The title is 'Wren — open their conversation' on 0.249.0, not
    // 'Message Wren', so the find returned undefined and .click() threw.
    // Matched on the name now, across title and aria-label, and a miss says
    // what was on screen instead of dying.
    const buttons = [...document.querySelectorAll('button')]
    const who = buttons.find(b => /Wren/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '')))
    if (!who) return 'NO TEAMMATE BUTTON: ' + buttons.map(b => b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '').filter(Boolean).join(' / ').slice(0, 300)
    who.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'NO COMPOSER: textareas present: ' + document.querySelectorAll('textarea').length
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word ALPHA and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'finished: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-120) ?? '')
    }
    return 'still running'
  })()`))
  await drive.capture('right-click the conversation: the row menu', () => drive.evaluate(`(async () => {
    // .lc-conv is the sidebar's conversation row -- the one whose
    // onContextMenu opens the mission menu (Sidebar.tsx). This looked for
    // .lc-teammate__mission, which is a different list, so step 3 found
    // nothing and steps 4-6 then tested an empty menu.
    const row = document.querySelector('.lc-conv') ?? document.querySelector('.lc-conv, .lc-teammate__mission')
    if (!row) return 'NO CONVERSATION ROW; sidebar classes: ' + [...new Set([...document.querySelectorAll('.lc-sidebar *')].map(n => String(n.className).split(' ')[0]).filter(Boolean))].join(' / ').slice(0, 300)
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 260 }))
    await new Promise(r => setTimeout(r, 400))
    return 'menu: ' + [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].map(b => b.innerText.trim()).join(' / ')
  })()`))
  await drive.capture('Save as routine: the dialog', () => drive.evaluate(`(async () => {
    // The row menu says "Save CONVERSATION as routine" (App.tsx); the dialog
    // it opens is still aria-labelled "Save as routine". Matching the
    // dialog's wording against the menu found nothing, so this step reported
    // "no menu item" over a menu that had the item in it.
    const item = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find(b => /Save (conversation )?as routine/i.test(b.innerText))
    if (!item) return 'NO MENU ITEM; menu reads: ' + [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].map(b => b.innerText.replace(/\\s+/g, ' ').trim()).join(' / ').slice(0, 300)
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
    //
    // The step and the branch are drawn by the COMPACT sidebar's rows
    // (.lc-teammate, Sidebar.tsx); the ordinary sidebar draws faces and
    // conversation rows and says neither. Waiting a minute for a line this
    // layout never draws is what used up the free model's whole run and left
    // the next step with nothing to see (2026-09-23), so without those rows
    // this reads once and moves on.
    let text = ''
    const compact = document.querySelector('.lc-teammate') !== null
    for (let i = 0; i < (compact ? 120 : 1); i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const found = [...document.querySelectorAll('.lc-teammate, .lc-conv')].find(r => /Wren|routine/i.test(r.innerText))
      text = found?.innerText ?? ''
      if (/routine · step/.test(text)) break
    }
    if (!compact) return 'this sidebar draws no routine step or branch (they are the compact rows’); the rows read: ' + ${conversationRows()}.map((c) => c.title.slice(0, 50) + (c.running ? ' (running)' : '')).join(' / ')
    const lines = text.split(String.fromCharCode(10)).map(t => t.trim()).filter(t => t.length > 0)
    return 'lines: ' + lines.length
      + ' || routine step shown: ' + /routine · step/.test(text)
      + ' || branch shown: ' + /on locust\\//.test(text)
      + ' || [' + lines.join(' / ') + ']'
  })()`))

  await drive.capture('the routine starts a run by itself', () => drive.evaluate(`(async () => {
    // Nothing has been pressed since the reopen, so a second conversation of
    // Wren's is the routine's even when the free model has already finished
    // it -- which a run of a few seconds usually has by the time this looks.
    const wrensNow = () => ${conversationRows()}.filter((c) => c.owner === 'tm_wren').length
    for (let i = 0; i < 240; i += 1) {
      if (wrensNow() >= 2) return 'a second conversation of Wren’s is in the sidebar, started by the routine: ' + ${conversationRows()}.filter((c) => c.owner === 'tm_wren').map((c) => c.title.slice(0, 50) + (c.running ? ' (running)' : '')).join(' / ')
      await new Promise(r => setTimeout(r, 500))
      const wren = ${teammateRows()}.find(r => /Wren/.test(r.innerText))
      if (wren && /working|running|starting|replying|thinking/i.test(wren.innerText)) return 'sidebar: ' + wren.innerText.replace(/\\s+/g, ' ').slice(0, 160)
      // The routine's run is a conversation of its own, not the one on
      // screen, so there is no Stop button to see: its row runs instead.
      const running = ${conversationRows()}.find((c) => c.running && c.owner === 'tm_wren')
      if (running) return 'a conversation of Wren’s is running: ' + running.title.slice(0, 120)
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'a run is live: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 160)
    }
    // A miss must say what it looked AT, not just that it saw nothing. This
    // waited on .lc-teammate rows and reported "nothing started" across two
    // minutes of a run that had in fact happened -- the sidebar draws those
    // rows in one branch only. Blind, not broken.
    const rails = ${teammateRows()}.length
    const convs = document.querySelectorAll('.lc-conv').length
    return 'nothing seen to start in two minutes (rail rows: ' + rails + ', conversation rows: ' + convs + '): '
      + (document.querySelector('.lc-sidebar')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no sidebar')
  })()`))
  await drive.capture('open that run: who started it', () => drive.evaluate(`(async () => {
    // .lc-conv is the sidebar's conversation row; .lc-teammate__mission
    // belongs to a list this screen does not draw, so this clicked
    // nothing and then reported the header it never opened as missing.
    const row = document.querySelector('.lc-conv') ?? document.querySelector('.lc-conv, .lc-teammate__mission')
    if (!row) return 'NO CONVERSATION ROW to open'
    row.click()
    await new Promise(r => setTimeout(r, 1200))
    return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no header')
  })()`))
  await drive.capture('let it finish, then the Team card', () => drive.evaluate(`(async () => {
    /*
     * Wait for the run to START, and only then for it to end.
     *
     * This used to break the moment no Stop button was present -- which is
     * also true before the routine has spawned anything, so on 2026-09-09 it
     * exited after 500ms and captured the card mid-run. Every reading this
     * step has ever produced said "in progress - 0 completed runs", and that
     * was the drive's own impatience rather than the app's state: the sidebar
     * in the same capture read "1 running" with the teammate "working".
     *
     * Which means the finished card -- the one that should say a completed run
     * happened -- had never once been looked at.
     *
     * Same shape as a wait for "rows > 1" that the placeholder rows satisfy:
     * an exit condition true of the state you are waiting to leave.
     */
    /*
     * Poll the ROUTINE ROW until it settles, which is the thing being asked
     * about.
     *
     * Two earlier versions both watched the Stop button and both were wrong in
     * opposite directions. Breaking as soon as it is absent exits before the
     * run has spawned, and captures "in progress" -- that is what every prior
     * reading of this step was. Waiting for it to appear first then times out,
     * because by the time this step runs the earlier steps have already let
     * the run start AND finish.
     *
     * The state of the button is not the question. Whether the routine's own
     * card stops saying "in progress" is, so that is what is polled -- true
     * whether the run finished a moment ago or is still going.
     */
    document.querySelector('button[title="Team (Ctrl 2)"]').click()
    await new Promise(r => setTimeout(r, 700))
    const rowText = () => [...document.querySelectorAll('.lc-routinerow')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
    for (let i = 0; i < 240; i += 1) {
      if (!/in progress/i.test(rowText())) break
      await new Promise(r => setTimeout(r, 500))
    }
    return rowText()
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'closed, back-dated five hours, reopened on the same profile', last: true })
  const { rm } = await import('node:fs/promises')
  if (handoff !== undefined) await rm(handoff.profile, { recursive: true, force: true }).catch(() => undefined)
}
