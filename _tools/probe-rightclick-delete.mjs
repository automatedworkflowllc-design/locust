// Right-click a conversation and delete it. Several turns, like a real one.
//
//   node _tools/probe-rightclick-delete.mjs
//
// "It's the right click delete issue I was having, the delete button on the
// actual convo is working" -- the first outside tester, narrowing his own
// report on 0.55.2.
//
// That matches what the probes already show: the header Delete removes the
// record every way it was pressed. drive-mission-menu.mjs also right-clicks
// and deletes -- and passes -- but on a conversation of ONE turn.
//
// A sidebar row is a CONVERSATION, and `collapseConversations` folds several
// mission records into one line titled by the first. Deleting the id under
// the cursor instead of every turn behind the row is exactly how this broke
// once before (Colin, 2026-09-05): the last turn went, the row stayed, and
// the menu read as doing nothing. So this drives the multi-turn case the
// passing drive does not.
//
// FREE: three short runs on the free OpenCode model, read-only.

import { FREE_ROUTE, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-rcdelete-ws-')
const drive = await startDrive({
  name: 'rightclick-delete',
  port: 9446,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  return 'done'
})()`)

/** Right-click the first conversation row and read the menu out. */
const openMenu = `(async () => {
  const row = document.querySelector('.lc-teammate__mission')
  if (!row) return 'NO CONVERSATION ROW TO RIGHT-CLICK'
  const box = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10)
  }))
  await new Promise(r => setTimeout(r, 500))
  const items = [...document.querySelectorAll('.lc-context__item')]
  if (items.length === 0) return 'MENU DID NOT OPEN'
  return items.map(b => b.innerText.replace(/\\s+/g, ' ').trim() + (b.disabled ? ' [DISABLED]' : '')).join(' | ')
})()`

const state = `'rows: ' + document.querySelectorAll('.lc-teammate__mission').length`

try {
  await drive.capture('launch and open Wren', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 600))
      return 'opened'
    })()`)
  })

  await drive.capture('three turns in one conversation', async () => {
    for (const word of ['ALPHA', 'BETA', 'GAMMA']) await send(`Reply with exactly one word: ${word}. Nothing else.`)
    return drive.evaluate(state)
  })

  /*
   * The premise, outside capture(): this is about a row that stands for
   * MORE THAN ONE record. If three turns collapsed into three separate
   * rows, or the runs never happened, the delete below is the single-turn
   * case that already passes and the probe would prove nothing.
   */
  const rows = Number(await drive.evaluate(`document.querySelectorAll('.lc-teammate__mission').length`))
  const records = Number(await drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    const n = document.querySelectorAll('.lc-missionrow').length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    return n
  })()`))
  say(`  ${String(rows)} conversation row(s) standing for ${String(records)} mission record(s)`)
  if (records < 2) throw new Error(`NOT A MULTI-TURN TEST: only ${String(records)} record(s), so the row stands for one turn`)

  await drive.capture('right-click it', () => drive.evaluate(openMenu))

  await drive.capture('and it still closes when you press outside it', () => drive.evaluate(`(async () => {
    // The fix excepts the menu from its own close. The other half has to
    // still hold: a press anywhere ELSE must close it, or the fix trades a
    // menu that eats its clicks for one that never goes away.
    const row = document.querySelector('.lc-teammate__mission') ?? document.querySelector('.lc-teammate')
    if (!row) return 'nothing left to right-click'
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
    await new Promise(r => setTimeout(r, 500))
    const opened = document.querySelectorAll('.lc-context__item').length
    if (opened === 0) return 'menu did not open, so nothing to dismiss'
    const away = document.querySelector('.lc-thread') ?? document.body
    const at = away.getBoundingClientRect()
    for (const type of ['mousedown', 'mouseup', 'click']) {
      away.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: Math.round(at.left + at.width / 2), clientY: Math.round(at.top + 40) }))
    }
    await new Promise(r => setTimeout(r, 400))
    return 'opened with ' + opened + ' items · closed on an outside press: ' + (document.querySelectorAll('.lc-context__item').length === 0)
  })()`))

  await drive.capture('press Delete like a mouse does, then the confirm', () => drive.evaluate(`(async () => {
    /*
     * A REAL press: mousedown, mouseup, click.
     *
     * Every drive in this repository presses with .click(), which sends no
     * mousedown -- and mousedown is the only event that broke this. The menu
     * closed on any mousedown in the capture phase without asking where it
     * landed, so a press on an item closed the menu before the press became
     * a click, and the item never ran. A harness that cannot send the event
     * that breaks a thing will report it working forever.
     */
    const press = (el) => {
      const box = el.getBoundingClientRect()
      const at = { bubbles: true, cancelable: true, clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) }
      for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, at))
    }
    // Reopen: the step before this one closed the menu on purpose.
    const row = document.querySelector('.lc-teammate__mission')
    if (!row) return 'no conversation row to right-click'
    const rowBox = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(rowBox.left + 20), clientY: Math.round(rowBox.top + 10) }))
    await new Promise(r => setTimeout(r, 500))
    const item = [...document.querySelectorAll('.lc-context__item')].find(b => b.innerText.trim().startsWith('Delete'))
    if (!item) return 'no Delete item in the menu'
    if (item.disabled) return 'Delete is DISABLED'
    press(item)
    await new Promise(r => setTimeout(r, 400))
    const stillOpen = document.querySelectorAll('.lc-context__item').length > 0
    const armed = [...document.querySelectorAll('.lc-context__item')].find(b => /Delete for good/.test(b.innerText))
    if (!armed) return 'MENU CLOSED ON ITS OWN PRESS -- still open: ' + stillOpen + ', confirm never appeared'
    press(armed)
    await new Promise(r => setTimeout(r, 2000))
    return ${state} + ' · said: ' + (document.querySelector('[role=alert]')?.innerText.replace(/\\s+/g, ' ').trim() || 'nothing')
  })()`))

  await drive.capture('did every turn go, or just one', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 1000))
    return 'mission records left: ' + document.querySelectorAll('.lc-missionrow').length +
      ' || ' + (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '')
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on the free OpenCode model, read-only. Three turns in one conversation, then deleted by right-clicking the sidebar row.' })
}
