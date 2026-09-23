// Delete a finished mission, both ways a person can.
//
//   node _tools/probe-delete-mission.mjs
//
// "deleted a mission doesn't work as well" -- the first outside tester, on
// 0.55.0. Delete is a two-click confirm: the first click arms the button and
// changes its word to "Delete for good?", the second does it. There are two
// of them, one in the conversation header and one in the sidebar row's menu,
// and this presses both.
//
// The question is not whether the host deletes -- it has tests -- but whether
// pressing the button on screen ends with the mission gone. A confirm that
// disarms itself, a click that lands on nothing, or a record removed while
// the row stays are all "doesn't work" from the outside.
//
// FREE: one short run on the free OpenCode model, read-only.

import { FREE_ROUTE, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-delete-ws-')
const drive = await startDrive({
  name: 'delete-mission',
  port: 9440,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-05T05:00:01.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Send a one-word task to a teammate and wait for it to end. */
const runOne = (name) => drive.evaluate(`(async () => {
  const open = ${teammateFace(name)}
  if (!open) return 'no button for ${name}'
  open.click()
  await new Promise(r => setTimeout(r, 400))
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Reply with exactly one word: DONE. Nothing else.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  return 'ran ${name}'
})()`)

const counts = `'missions: ' + document.querySelectorAll('.lc-missionrow').length + ' · sidebar conversations: ' + document.querySelectorAll('.lc-teammate__mission').length`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('run two short missions so there is something to delete', async () => {
    await runOne('Wren')
    await runOne('Booty')
    return drive.evaluate(counts)
  })

  // The premise, outside capture(): with nothing recorded there is nothing
  // to delete, and every step below would pass by pressing nothing.
  const before = Number(await drive.evaluate(`document.querySelectorAll('.lc-teammate__mission').length`))
  if (before < 2) throw new Error(`NOT A DELETE TEST: only ${String(before)} conversation(s) recorded`)
  say(`  ${String(before)} conversations before deleting`)

  await drive.capture('the header Delete: first click arms it', () => drive.evaluate(`(async () => {
    const conversation = document.querySelector('.lc-teammate__mission')
    if (!conversation) return 'no conversation to open'
    conversation.click()
    await new Promise(r => setTimeout(r, 900))
    const button = [...document.querySelectorAll('.lc-workroom__header button, .lc-workroom button')].find(b => b.innerText.trim() === 'Delete')
    if (!button) return 'no Delete button in the header'
    button.click()
    await new Promise(r => setTimeout(r, 400))
    const now = [...document.querySelectorAll('button')].find(b => /Delete for good/.test(b.innerText))
    return 'armed: ' + (now !== undefined) + ' · label: ' + (now?.innerText.trim() ?? [...document.querySelectorAll('button')].filter(b => /Delete/.test(b.innerText)).map(b => b.innerText.trim()).join(', '))
  })()`))

  await drive.capture('second click on the same button', () => drive.evaluate(`(async () => {
    const armed = [...document.querySelectorAll('button')].find(b => /Delete for good/.test(b.innerText))
    if (!armed) return 'NOT ARMED: nothing to press a second time'
    armed.click()
    await new Promise(r => setTimeout(r, 1500))
    return ${counts} + ' · error: ' + (document.querySelector('.lc-tone-red')?.innerText.replace(/\\s+/g, ' ').slice(0, 90) ?? 'none')
  })()`))

  await drive.capture('does the mouse leaving the button disarm it', () => drive.evaluate(`(async () => {
    // The confirm disarms on blur. If moving to press it counts as leaving,
    // every click just re-arms and the record never goes -- which is what
    // "doesn't work" looks like from the outside.
    const button = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Delete')
    if (!button) return 'no Delete button left'
    button.click()
    await new Promise(r => setTimeout(r, 300))
    const armedNow = [...document.querySelectorAll('button')].some(b => /Delete for good/.test(b.innerText))
    document.body.click()
    await new Promise(r => setTimeout(r, 300))
    const stillArmed = [...document.querySelectorAll('button')].some(b => /Delete for good/.test(b.innerText))
    return 'armed after click: ' + armedNow + ' · still armed after clicking the page: ' + stillArmed
  })()`))

  await drive.capture('the sidebar row menu Delete', () => drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-teammate__mission')
    if (!row) return 'no conversation rows left'
    const menu = row.parentElement?.querySelector('button[aria-haspopup="menu"]') ?? row.querySelector('button[aria-haspopup="menu"]')
    if (!menu) return 'no row menu button · row html: ' + (row.parentElement?.innerHTML ?? '').replace(/\\s+/g, ' ').slice(0, 160)
    menu.click()
    await new Promise(r => setTimeout(r, 500))
    const item = [...document.querySelectorAll('[role=menuitem], .lc-menu__item, button')].find(b => b.innerText.trim() === 'Delete')
    if (!item) return 'menu opened but no Delete item'
    item.click()
    await new Promise(r => setTimeout(r, 500))
    const confirm = [...document.querySelectorAll('button, [role=menuitem]')].find(b => /Delete for good|Delete\\?/.test(b.innerText))
    if (confirm) { confirm.click(); await new Promise(r => setTimeout(r, 1200)) }
    return 'confirmed: ' + (confirm !== undefined) + ' · ' + ${counts}
  })()`))

  await drive.capture('what is left after both', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    return ${counts} + ' || ' + (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '')
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Two teammates on the free OpenCode model, read-only. Two short missions run, then deleted from the header and from the sidebar row.' })
}
