// A room post that cannot reach everyone, because other work is in the way.
//
//   node _tools/drive-room-absent.mjs
//
// Since the cap was measured and raised to 8 -- matching MAX_ROOM_TEAMMATES --
// a room can no longer outgrow it by its own size. But the cap counts EVERY
// live mission, not just this room's, so a full room posted while other
// teammates are working still leaves members unasked. That is the state this
// drives, and it is now the only way to reach it.
//
// Three teammates are given long work first. Then a room of eight is posted
// to. Five slots are left, so three members are never asked -- and the
// question is what the screen says about them.
//
// Until 2026-09-09 it said it with two things, both wrong. Each absent member
// got an ANSWER CARD with no answer in it: an avatar, a name, `did not start`,
// and 90px of void, taking its height from a neighbouring cell's wrapping
// model name. And the reason was in the composer note, repeated once per
// person, in the smallest text on the screen, far below the cards it
// explained. Now: no card, one standing line naming them, and the host's
// reason said once for everyone who shares it.
//
// FREE: eleven short runs on the free OpenCode model, read-only.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const BUSY = ['Ash', 'Bryn', 'Cove']
const ROOM = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike', 'Dell', 'Ember']
const HUES = ['lime', 'blue', 'clay', 'violet']

const workspace = await scratchRepository(
  'locust-drive-room-absent-ws-',
  'Answer exactly what you are asked for, at whatever length that takes. Do not shorten or summarise.\n'
)
const drive = await startDrive({
  name: 'room-absent',
  port: 9434,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [...BUSY, ...ROOM].map((name, i) => ({
      teammateId: `tm_${name.toLowerCase()}`,
      name,
      hue: HUES[i % HUES.length],
      role: 'Code & Migrations',
      createdAt: `2026-09-05T05:00:${String(i).padStart(2, '0')}.000Z`,
      route: { ...FREE_ROUTE, mode: 'ask' }
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Address one teammate and send without waiting. */
const startFor = (name) => drive.evaluate(`(async () => {
  const open = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ${name}'))
  if (!open) return 'no button for ${name}'
  open.click()
  await new Promise(r => setTimeout(r, 400))
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Count from 1 to 2000. Put each number on its own line, in order, with no other text. Do not stop early and do not edit any files.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  await new Promise(r => setTimeout(r, 600))
  return 'sent to ${name}'
})()`)

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('make a room of the other eight', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const input = document.querySelector('input[aria-label="Room name"]')
    if (!input) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Standup'); input.dispatchEvent(new Event('input', { bubbles: true }))
    const wanted = ${JSON.stringify(ROOM)}
    const members = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')]
    for (const m of members) {
      const mine = wanted.some(name => m.innerText.trim() === name)
      if (mine !== (m.getAttribute('aria-checked') === 'true')) m.click()
    }
    await new Promise(r => setTimeout(r, 300))
    const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
    if (!create || create.disabled) return 'Create room disabled'
    create.click()
    await new Promise(r => setTimeout(r, 1200))
    return (document.querySelector('.lc-roomcompose__box') !== null ? 'MADE' : 'NOT MADE') + ' · ' + (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '')
  })()`))

  await drive.capture('three teammates start long work first', async () => {
    const sent = []
    for (const name of BUSY) sent.push(await startFor(name))
    return sent.join(' · ')
  })

  /*
   * The premise, outside capture(): three missions must STILL be live when
   * the post goes out, or the room has all eight slots and nobody is turned
   * away -- and the drive would report a missing line that is correctly
   * missing.
   *
   * The first run did exactly that. It counted ancestor nodes rather than
   * teammates (it reported 19 busy rows out of 11 teammates), made the room
   * afterwards, and by the time it posted the three short runs had finished.
   * All eight started, no line appeared, and it read as the fix not working.
   * Fourth premise a drive has failed to check this session.
   */
  const busyNow = () => drive.evaluate(`(document.querySelector('.lc-sidebar')?.innerText.match(/· (working|thinking)/g) ?? []).length`)
  let live = 0
  for (let attempt = 0; attempt < 40 && live < BUSY.length; attempt += 1) {
    live = Number(await busyNow())
    if (live < BUSY.length) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (live < BUSY.length) {
    throw new Error(`NOT AN ABSENT TEST: only ${String(live)} of ${String(BUSY.length)} missions were live, so the room was never short of slots`)
  }
  say(`  ${String(live)} live before the post, leaving ${String(8 - live)} slots for a room of ${String(ROOM.length)}`)

  await drive.capture('post to all eight while three are busy', () => drive.evaluate(`(async () => {
    // Addressing a teammate opened their workroom, so the room has to be
    // opened again before there is a compose box to post into.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 600))
    const row = [...document.querySelectorAll('.lc-roomrow')].find(r => /Standup/.test(r.innerText))
      ?? [...document.querySelectorAll('.lc-roomcard')].find(r => /Standup/.test(r.innerText))
    if (row) row.click()
    await new Promise(r => setTimeout(r, 700))
    const box = document.querySelector('.lc-roomcompose__box')
    if (!box) return 'no compose box'
    const stillBusy = (document.querySelector('.lc-sidebar')?.innerText.match(/· (working|thinking)/g) ?? []).length
    if (stillBusy < 3) return 'NOT AN ABSENT TEST: only ' + stillBusy + ' still live at the moment of posting'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Reply with exactly one word: READY. Nothing else.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    /*
     * How long until the FIRST row appears.
     *
     * The measurement Astra's finding asks for: a process ran 45,292 ms
     * before its row did, because the post started everyone in sequence and
     * announced them all afterwards. Polled at 100ms from the submit, so a
     * regression to batch announcing is a number here rather than a shrug.
     */
    const submitted = performance.now()
    document.querySelector('.lc-roomcompose').requestSubmit()
    let firstCardAt = -1
    for (let i = 0; i < 400; i += 1) {
      await new Promise(r => setTimeout(r, 100))
      if (document.querySelector('.lc-roomanswer') !== null) { firstCardAt = Math.round(performance.now() - submitted); break }
    }
    await new Promise(r => setTimeout(r, 2500))
    return 'head: ' + (document.querySelector('.lc-posthead__counts')?.innerText.trim() ?? 'NO HEADER') +
      ' · faces: ' + document.querySelectorAll('.lc-posthead__face').length +
      ' · first card after ' + firstCardAt + 'ms · cards: ' + document.querySelectorAll('.lc-roomanswer').length +
      ' · waiting: ' + (document.querySelector('.lc-roomwaiting')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE') +
      ' · absent line: ' + (document.querySelector('.lc-roomabsent')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE') +
      ' · note: ' + (document.querySelector('.lc-roomcompose__row .lc-settings__note')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none')
  })()`))

  await drive.capture('no empty answer cards anywhere', () => drive.evaluate(`(async () => {
    // The old shape, named exactly: a card with a name and no answer.
    const empty = [...document.querySelectorAll('.lc-roomanswer')].filter(c => c.querySelector('.lc-roomanswer__text') === null && !/running|starting/.test(c.innerText))
    return 'is-absent cards: ' + document.querySelectorAll('.lc-roomanswer.is-absent').length +
      ' · says "did not start": ' + /did not start/.test(document.body.innerText) +
      ' · answerless cards: ' + empty.length
  })()`))

  await drive.capture('the room once the busy three free their slots', () => drive.evaluate(`(async () => {
    /*
     * Waits for the QUEUE to empty too, not just for the started cards to
     * finish. With a queue, five cards all reading completed is a moment
     * partway through -- three more are still to start. Breaking there
     * reported five of eight and read as the queue not draining.
     */
    for (let i = 0; i < 900; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      const stillWaiting = document.querySelector('.lc-roomwaiting') !== null
      if (!stillWaiting && phases.length > 0 && phases.every(p => /completed|failed|cancelled/i.test(p))) break
    }
    return 'cards: ' + document.querySelectorAll('.lc-roomanswer').length +
      ' · absent line: ' + (document.querySelector('.lc-roomabsent')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE') +
      ' · note: ' + (document.querySelector('.lc-roomcompose__row .lc-settings__note')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Eleven teammates on the free OpenCode model, read-only. Three given long work first, then a room of the other eight posted to, so the live cap turns some of the room away.' })
}
