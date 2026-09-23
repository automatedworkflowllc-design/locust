// A person makes a room, posts to it, and watches every teammate answer.
//
//   node _tools/drive-room.mjs
//
// Two teammates on the free OpenCode model. The room is made through the
// form a person uses (name, members, Create room), one post goes in, and
// the screen is kept as the answer cards start, run, and finish.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-room-ws-')
const drive = await startDrive({
  name: 'room',
  port: 9296,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const roomState = `JSON.stringify({
  title: document.querySelector('.lc-room__name, .lc-screen__title')?.innerText ?? '',
  posts: document.querySelectorAll('.lc-roompost').length,
  cards: [...document.querySelectorAll('.lc-roomanswer')].map(c => (c.querySelector('.lc-face')?.getAttribute('aria-label')?.trim() ?? '') + ' · ' + (c.querySelector('.lc-roomanswer__phase')?.textContent.trim() ?? '') + ' · ' + (c.querySelector('.lc-roomanswer__text')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60) ?? ''))
})`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open Rooms with Ctrl 4: none yet, the form is right there', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' · ' + (document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || form: ' + !!document.querySelector('input[aria-label="Room name"]')
  })()`))
  await drive.capture('name it Release, add both teammates', () => drive.evaluate(`(async () => {
    const input = document.querySelector('input[aria-label="Room name"]')
    if (!input) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Release'); input.dispatchEvent(new Event('input', { bubbles: true }))
    const members = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')]
    for (const m of members) if (m.getAttribute('aria-checked') !== 'true') m.click()
    await new Promise(r => setTimeout(r, 300))
    return 'members: ' + members.map(m => m.innerText.trim() + '=' + m.getAttribute('aria-checked')).join(', ')
  })()`))
  await drive.capture('Create room', () => drive.evaluate(`(async () => {
    const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
    if (!create || create.disabled) return 'Create room disabled'
    create.click()
    await new Promise(r => setTimeout(r, 900))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' || sidebar rooms: ' + [...document.querySelectorAll('.lc-roomrow .lc-row__name, .lc-conv--room .lc-conv__title')].map(el => el.textContent.trim()).join(', ')
  })()`))
  await drive.capture('post a question to the room', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    if (!box) return 'no compose box'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'In one sentence each: what does README.md say this project is? Reply with the sentence only.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelectorAll('.lc-roompost').length >= 1) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return ${roomState}
  })()`))
  await drive.capture('the sidebar while both run', () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 260)`))
  await drive.capture('wait for both answers', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      if (phases.length >= 2 && phases.every(p => /completed|failed|cancelled/.test(p))) return ${roomState}
    }
    return 'still running: ' + ${roomState}
  })()`))
  /*
   * WHAT COLOUR EACH PART OF AN ANSWER HEADER ACTUALLY IS.
   *
   * The handover's §4.2 says the route line "renders across four or five
   * colours ... it reads as syntax highlighting", the clearest violation of
   * the system's own rule that blue/amber/red carry meaning and never
   * hierarchy. That is a claim about pixels, and the frames it was made from
   * were never committed, so it cannot be checked by reading anything.
   *
   * It is also a claim worth checking before acting on: the last confident
   * assertion from that document -- that a duplicate `.lc-switch` block was
   * "a dead rule worth deleting regardless" -- was wrong in a way that took
   * two real defects to discover.
   *
   * So the drive reads the computed colour of every span in the header and
   * counts the distinct ones. No opinion, just the count and the values.
   */
  await drive.capture('what tones the answer header is drawn in', () => drive.evaluate(`(() => {
    const header = document.querySelector('.lc-roomanswer__who')
    if (!header) return 'no answer header on screen'
    const parts = [...header.querySelectorAll('span, button')]
      .filter(el => (el.textContent ?? '').trim().length > 0 && el.children.length === 0)
      .map(el => ({
        text: (el.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 34),
        className: el.className,
        color: getComputedStyle(el).color
      }))
    return JSON.stringify({ distinct: [...new Set(parts.map(p => p.color))].length, parts })
  })()`))
  await drive.capture('Open on a card goes to that mission', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.lc-roomanswer .lc-ghostbutton')].find(b => b.innerText.trim() === 'Open')
    if (!button) return 'no Open button'
    button.click()
    await new Promise(r => setTimeout(r, 800))
    return document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no header'
  })()`))
  /*
   * SAYS SO WHEN IT DID NOT GO BACK.
   *
   * This clicked a `.lc-roomrow` matching /Release/ and, when there was no
   * such row, clicked NOTHING and reported the room state of whatever screen
   * it was already on -- the mission thread step 08 opened. The design
   * handover of 2026-09-21 (§6.3) read the resulting `{posts: 0, cards: []}`
   * as a room that had lost its answers and nearly filed it as a functional
   * bug. It is not one: the room selectors found nothing because the screen
   * was not the room.
   *
   * An assertion that cannot fail is not an assertion. Same wrong assumption
   * the hub smoke's first draft made -- `selectTeammate` has always opened
   * the newest conversation, not the one you meant.
   */
  await drive.capture('back to the room from the sidebar', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-roomrow, .lc-conv--room')].find(r => /Release/.test(r.innerText))
    if (!row) return 'NO ROOM ROW named Release in the sidebar -- did not navigate, so nothing below is about the room'
    row.click()
    await new Promise(r => setTimeout(r, 700))
    const title = document.querySelector('.lc-room__name, .lc-screen__title')?.innerText ?? ''
    if (!/Release/.test(title)) return 'CLICKED the room row and landed on ' + JSON.stringify(title) + ' instead'
    return ${roomState}
  })()`))


} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren and Booty on the free OpenCode model, read-only. A room made through the form, one post, both answers watched.' })
}
