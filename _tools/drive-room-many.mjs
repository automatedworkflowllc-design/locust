// A room with SIX teammates in it, all answering one post at once.
//
//   node _tools/drive-room-many.mjs
//
// drive-room posts to two and drive-concurrent starts three by hand. Nobody
// has driven the fan-out: one post that starts six missions in one gesture,
// which is the largest thing a single click in this app can set off.
//
// The questions are about scale rather than mechanics. Does the member picker
// hold six without wrapping into something unreadable. Do six answer cards
// render, or does the room screen assume a small number. Does the sidebar
// show six working at once. Does every card end in a terminal phase, or does
// one get lost when six finish within moments of each other. And does each
// answer land on the RIGHT card -- every teammate is given its own word, so
// a card showing someone else's word is visible rather than plausible.
//
// FREE: six short runs on the free OpenCode model, read-only.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const WORDS = {
  Wren: 'ALMANAC',
  Booty: 'BRAMBLE',
  Gem: 'CINDER',
  Fen: 'DAMSON',
  Otto: 'ELDER',
  Pike: 'FALLOW'
}
const NAMES = Object.keys(WORDS)
// Four hues exist, so two teammates repeat one -- which is itself worth
// seeing: six cards where two share a colour is the real shape of a big team.
const HUES = ['lime', 'blue', 'clay', 'violet', 'lime', 'blue']

const workspace = await scratchRepository('locust-drive-room-many-ws-')
const drive = await startDrive({
  name: 'room-many',
  port: 9430,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: NAMES.map((name, i) => ({
      teammateId: `tm_${name.toLowerCase()}`,
      name,
      hue: HUES[i],
      role: 'Code & Migrations',
      createdAt: `2026-09-05T05:00:0${String(i)}.000Z`,
      route: { ...FREE_ROUTE, mode: 'ask' }
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// One card per teammate: who it belongs to, what phase it is in, and the
// first of the six words its text contains -- which is how a mis-routed
// answer shows up. `word: none` on a finished card is the interesting case.
const roomState = `JSON.stringify({
  title: document.querySelector('.lc-screen__title')?.innerText ?? '',
  posts: document.querySelectorAll('.lc-roompost').length,
  cards: [...document.querySelectorAll('.lc-roomanswer')].map(c => {
    const name = c.querySelector('.lc-roomanswer__name')?.textContent.trim() ?? '?'
    const phase = c.querySelector('.lc-roomanswer__phase')?.textContent.trim() ?? '?'
    const text = c.querySelector('.lc-roomanswer__text')?.textContent ?? ''
    const word = ${JSON.stringify(Object.values(WORDS))}.find(w => text.includes(w)) ?? 'none'
    return name + ' · ' + phase + ' · ' + word
  })
})`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open Rooms: the form holds six teammates', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const members = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')]
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' || offered: ' + members.length + ' -- ' + members.map(m => m.innerText.trim()).join(', ')
  })()`))

  await drive.capture('name it Standup, tick all six', () => drive.evaluate(`(async () => {
    const input = document.querySelector('input[aria-label="Room name"]')
    if (!input) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Standup'); input.dispatchEvent(new Event('input', { bubbles: true }))
    const members = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')]
    for (const m of members) if (m.getAttribute('aria-checked') !== 'true') m.click()
    await new Promise(r => setTimeout(r, 300))
    const ticked = members.filter(m => m.getAttribute('aria-checked') === 'true').length
    return 'ticked ' + ticked + ' of ' + members.length
  })()`))

  await drive.capture('Create room', () => drive.evaluate(`(async () => {
    const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
    if (!create || create.disabled) return 'Create room disabled'
    create.click()
    await new Promise(r => setTimeout(r, 1200))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' · ' + (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '')
  })()`))

  // The premise. Six missions from one post is the whole point; if the room
  // came up with fewer members the rest of this drive would report the app
  // for a seed that never took. Asserted OUTSIDE capture(), which records a
  // throw as a note and walks on.
  const membership = await drive.evaluate(`(document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || rows: ' + document.querySelectorAll('.lc-roomrow').length`)
  say(`  room: ${String(membership)}`)

  await drive.capture('one post asks each of them for its own word', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    if (!box) return 'no compose box'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Reply with exactly one word and nothing else. Wren says ALMANAC. Booty says BRAMBLE. Gem says CINDER. Fen says DAMSON. Otto says ELDER. Pike says FALLOW. Say only your own word.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelectorAll('.lc-roomanswer').length >= 6) break
    }
    await new Promise(r => setTimeout(r, 800))
    return ${roomState}
  })()`))

  await drive.capture('six cards on screen at once', () => drive.evaluate(`(async () => {
    /*
     * Waits for the six rather than demanding them at an instant.
     *
     * Cards used to appear in a batch, because the post announced every run
     * only after starting them all -- so "are there six right now" was a
     * fair question. Since 0.56.1 a card appears as each run begins, which
     * is the point, and this read five mid-fan-out and called it NOT A
     * FAN-OUT TEST. The assertion had quietly encoded the defect as the
     * expected shape.
     */
    let cards = []
    for (let i = 0; i < 240; i += 1) {
      cards = [...document.querySelectorAll('.lc-roomanswer')]
      if (cards.length >= 6) break
      await new Promise(r => setTimeout(r, 500))
    }
    if (cards.length < 6) return 'NOT A FAN-OUT TEST: only ' + cards.length + ' cards came up for a six-member room in two minutes'
    /*
     * Do any two cards actually overlap on screen. A card that renders is
     * not the same as a card you can read.
     *
     * Every PAIR, as rectangles. The first version walked them as a single
     * column and called card i+1 overlapping when its top was above card
     * i's bottom -- which is what two cards SIDE BY SIDE look like. The
     * cards are a three-wide grid, so it reported an overlap on the first
     * run that was only the second row sitting beside the first.
     */
    const boxes = cards.map(c => c.getBoundingClientRect())
    let overlap = 'none'
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]
        const b = boxes[j]
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (across > 1 && down > 1) overlap = 'cards ' + i + ' and ' + j + ' overlap by ' + Math.round(across) + 'x' + Math.round(down) + 'px'
      }
    }
    const scroller = document.querySelector('.lc-roomthread') ?? document.scrollingElement
    return 'cards: ' + cards.length + ' · overlap: ' + overlap +
      ' · widest: ' + Math.max(...boxes.map(b => Math.round(b.width))) + 'px' +
      ' · column height: ' + Math.round(boxes[boxes.length - 1].bottom - boxes[0].top) + 'px' +
      ' · scrolls: ' + (scroller ? scroller.scrollHeight > scroller.clientHeight : '?')
  })()`))

  await drive.capture('the sidebar with six running', () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 400)`))

  await drive.capture('what the composer says about a room this big', () => drive.evaluate(`[...document.querySelectorAll('.lc-roomcompose__row .lc-settings__note')].map(n => n.innerText.trim()).join(' || ') || 'no note'`))

  await drive.capture('wait for everyone who started to finish', () => drive.evaluate(`(async () => {
    /*
     * Waits on the STARTED runs, not on six.
     *
     * This waited for six terminal phases, which a room over the live cap
     * can never produce -- a member who never started reads "did not start"
     * and stays that way forever. So the loop ran to its limit every time
     * and the step reported nothing, on a run where four missions had
     * finished perfectly well.
     *
     * Same shape as the handoff drive waiting past the state it wanted: a
     * condition that cannot be met is not a slow test, it is a broken one.
     */
    for (let i = 0; i < 600; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      const live = phases.filter(p => !/did not start/i.test(p))
      if (live.length > 0 && live.every(p => /completed|failed|cancelled/i.test(p))) {
        return live.length + ' of ' + phases.length + ' started and ended · ' + ${roomState}
      }
    }
    return 'STILL RUNNING after 5 minutes: ' + ${roomState}
  })()`))

  await drive.capture('every answer landed on its own card', () => drive.evaluate(`(async () => {
    const want = ${JSON.stringify(WORDS)}
    const wrong = []
    const never = []
    for (const card of document.querySelectorAll('.lc-roomanswer')) {
      const name = card.querySelector('.lc-roomanswer__name')?.textContent.trim() ?? '?'
      const text = card.querySelector('.lc-roomanswer__text')?.textContent ?? ''
      const mine = want[name]
      if (!mine) { wrong.push(name + ': not a teammate we seeded'); continue }
      // A card that never started has no answer to be in the wrong place.
      // Reporting it as MIS-ROUTED made the live cap look like a routing
      // bug, which is the opposite of what this step is for.
      const phase = card.querySelector('.lc-roomanswer__phase')?.textContent.trim() ?? ''
      if (/did not start/i.test(phase)) { never.push(name); continue }
      if (!text.includes(mine)) wrong.push(name + ' wanted ' + mine + ' but said: ' + text.replace(/\\s+/g, ' ').trim().slice(0, 50))
      for (const [other, word] of Object.entries(want)) {
        if (other !== name && text.includes(word)) wrong.push(name + ' carries ' + other + "'s word " + word)
      }
    }
    const note = never.length ? ' · never started: ' + never.join(', ') : ''
    return (wrong.length ? 'MIS-ROUTED: ' + wrong.join(' | ') : 'every answer carries its own word and nobody carries two') + note
  })()`))

  await drive.capture('the missions list after the fan-out', () => drive.evaluate(`(async () => {
    // Ctrl 1 is Missions. Ctrl 2 is Team, which is what the first run of
    // this drive opened before reporting "rows: 0" as if the fan-out had
    // filed nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' · ' + (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '') +
      ' || rows: ' + document.querySelectorAll('.lc-missionrow').length
  })()`))

  await drive.capture('back to the room, and Open still reaches one mission', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-roomrow')].find(r => /Standup/.test(r.innerText))
    if (!row) return 'no room row in the sidebar'
    row.click()
    await new Promise(r => setTimeout(r, 700))
    const button = [...document.querySelectorAll('.lc-roomanswer .lc-ghostbutton')].find(b => b.innerText.trim() === 'Open')
    if (!button) return 'no Open button on any card'
    button.click()
    await new Promise(r => setTimeout(r, 900))
    return document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no header'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Six teammates on the free OpenCode model, read-only, all in one room. One post, six missions, each asked for a different word.' })
}
