// Ask one teammate in a room (0.371).
//
//   LOCUST_SPEND=1 node _tools/drive-room-ask-one.mjs [--packaged <exe>] [--tag <name>]
//
// A post asked everyone in the room. Now Reply on an answer, or an @ in the
// room's box, puts the next post to the teammates named, and only they run.
//
// Two teammates on two of OpenCode's free models, read-only, relay off, and
// typed into the way a person types: real key and text events over CDP, not
// a value set on the field. Post one goes to both (name a fruit). Reply on
// Wren's answer puts Wren in the box; post two asks Wren alone. "@P" then
// Enter puts Pip in the box; post three asks Pip alone what WREN named first
// -- which only a member told the room so far can answer. Then "@wren "
// becomes a tile by itself, and Backspace at the start takes it off again.
//
// Free models only: nothing is spent. LOCUST_SPEND=1 is still required.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('room-ask-one-2026-09-26'), `room-ask-one-${tag}`)
await mkdir(OUT, { recursive: true })

const WREN_MODEL = process.env.LOCUST_ROOM_MODEL_A ?? 'opencode/nemotron-3-ultra-free'
const PIP_MODEL = process.env.LOCUST_ROOM_MODEL_B ?? 'opencode/longcat-2.5-preview-free'

const workspace = await scratchRepository('locust-room-ask-one-ws-')
const now = '2026-09-26T05:00:00.000Z'
const drive = await startDrive({
  name: `room-ask-one-${tag}`,
  port: 9672,
  workspace,
  outPath: OUT,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: { runtime: 'opencode', model: WREN_MODEL, mode: 'ask' } },
      { teammateId: 'tm_pip', name: 'Pip', hue: 'violet', role: 'Docs & QA', createdAt: now, route: { runtime: 'opencode', model: PIP_MODEL, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: {
    'rooms.json': {
      schemaVersion: 1,
      rooms: [{ roomId: 'rm_pair', name: 'pair', teammateIds: ['tm_wren', 'tm_pip'], createdAt: now, posts: [] }]
    }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// Real input: the text arrives in the focused field as typing delivers it,
// and a key is a key down and up.
const focusBox = () => drive.evaluate(`(() => { const box = document.querySelector('.lc-roomcompose__box'); box?.focus(); return box === null ? 'no box' : 'focused' })()`)
const type = async (text) => {
  for (const character of text) await drive.send('Input.insertText', { text: character })
  await sleep(300)
}
const press = async (key, code, keyCode) => {
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
  await sleep(400)
}
const enter = () => press('Enter', 'Enter', 13)

// What the room's box shows: the tiles, the placeholder, the text, the menu.
const BOX = `(() => {
  const box = document.querySelector('.lc-roomcompose__box')
  return JSON.stringify({
    tiles: [...document.querySelectorAll('.lc-askto__tile')].map((tile) => tile.innerText.trim()),
    placeholder: box?.getAttribute('placeholder') ?? '',
    text: box?.value ?? '',
    focused: document.activeElement === box,
    menu: [...document.querySelectorAll('.lc-mentions [role="option"]')].map((option) => (option.querySelector('.lc-slash__name')?.textContent ?? '').trim())
  })
})()`
const boxState = async () => JSON.parse(String(await drive.evaluate(BOX)))

const READ = `(() => JSON.stringify({
  posts: [...document.querySelectorAll('.lc-roompost')].map((section) => ({
    at: (section.querySelector('.lc-roompost__at')?.textContent ?? '').trim(),
    absent: (section.querySelector('.lc-roomabsent')?.textContent ?? '').trim(),
    answers: [...section.querySelectorAll('.lc-roomanswer')].map((card) => {
      const teammateId = (card.getAttribute('data-answer') ?? ':').split(':')[1]
      const who = card.querySelector('.lc-roomanswer__who')
      const phase = (card.querySelector('.lc-roomanswer__phase')?.textContent ?? '').trim()
      const all = (card.innerText ?? '').replace(/\\s+/g, ' ').trim()
      const head = (who?.innerText ?? '').replace(/\\s+/g, ' ').trim()
      return { teammateId, phase, text: all.startsWith(head) ? all.slice(head.length).trim() : all }
    })
  }))
}))()`
const room = async () => JSON.parse(String(await drive.evaluate(READ)))
const finished = (answer) => answer.phase.length > 0 && !/^(asked|running)/.test(answer.phase)

/** The Nth post once `expected` members have finished it, then a little longer to see nobody else starts. */
async function settled(index, expected, patienceMs = 300_000) {
  let post
  for (let waited = 0; waited < patienceMs; waited += 2000) {
    await sleep(2000)
    post = (await room()).posts[index]
    if (post !== undefined && post.answers.length >= expected && post.answers.every(finished)) break
  }
  await sleep(6000)
  return (await room()).posts[index]
}

const FRUIT = /\b(apple|apricot|avocado|banana|blackberry|blueberry|cantaloupe|cherry|coconut|cranberry|date|dragonfruit|durian|fig|grape|grapefruit|guava|honeydew|jackfruit|kiwi|kumquat|lemon|lime|lychee|mango|mangosteen|melon|nectarine|orange|papaya|passionfruit|peach|pear|persimmon|pineapple|plum|pomegranate|quince|raspberry|starfruit|strawberry|tangerine|watermelon)\b/i
const fruitOf = (text) => FRUIT.exec(text)?.[1]?.toLowerCase()

try {
  await drive.ready()
  await drive.resize(1215, 800)
  const opened = await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim() === 'Rooms')?.click()
    await new Promise((r) => setTimeout(r, 1000))
    const row = [...document.querySelectorAll('.lc-roomcard, .lc-roomrow')].find((r) => /pair/.test(r.innerText))
    if (row === undefined) return 'no room row'
    row.click()
    await new Promise((r) => setTimeout(r, 900))
    return 'open'
  })()`)
  check('the room opened', String(opened) === 'open', String(opened))

  // 1. Everyone.
  await focusBox()
  await type('Each of you, name one fruit. Reply with that single word and nothing else. Change nothing.')
  await enter()
  const first = await settled(0, 2)
  say(`post one: ${JSON.stringify(first)}`)
  const fruits = Object.fromEntries((first?.answers ?? []).map((answer) => [answer.teammateId, fruitOf(answer.text)]))
  check('post one went to both, and both named a fruit', fruits.tm_wren !== undefined && fruits.tm_pip !== undefined, JSON.stringify(fruits))

  // 2. Reply on Wren's answer: Wren goes in the box, the caret with it.
  const replied = await drive.capture('Reply on Wren’s answer puts Wren in the box', async () => {
    await drive.evaluate(`(() => document.querySelector('.lc-roompost .lc-roomanswer[data-answer$=":tm_wren"] button[aria-label="Reply to Wren"]')?.click())()`)
    await sleep(500)
    return drive.evaluate(BOX)
  })
  const afterReply = JSON.parse(String(replied))
  check('Reply puts Wren in the box, says so in the box, and leaves the caret there', afterReply.tiles.join('|') === 'Wren' && afterReply.placeholder === 'Ask Wren…' && afterReply.focused, String(replied))
  await type('Which fruit did you name? One word.')
  await enter()
  const second = await settled(1, 1)
  say(`post two: ${JSON.stringify(second)}`)
  check('post two ran Wren alone', (second?.answers ?? []).map((answer) => answer.teammateId).join('|') === 'tm_wren', JSON.stringify(second?.answers?.map((answer) => answer.teammateId)))
  check('post two says who it was put to, and nobody is "not asked"', /^To Wren · /.test(second?.at ?? '') && (second?.absent ?? '') === '', JSON.stringify({ at: second?.at, absent: second?.absent }))
  const cleared = await boxState()
  check('the box asks everyone again once the post is made', cleared.tiles.length === 0 && cleared.placeholder === 'Post to pair…', JSON.stringify(cleared))

  // 3. The @ menu: "@" offers both, "@P" offers Pip, Enter names Pip.
  await focusBox()
  await type('@')
  const offered = await boxState()
  check('"@" offers the room’s members', offered.menu.join('|') === 'Wren|Pip', JSON.stringify(offered.menu))
  const narrowed = await drive.capture('"@P" offers Pip', async () => {
    await type('P')
    return drive.evaluate(BOX)
  })
  check('"@P" offers Pip alone', JSON.parse(String(narrowed)).menu.join('|') === 'Pip', String(narrowed))
  await enter()
  const picked = await boxState()
  check('Enter names Pip: the tile goes in, "@P" comes out, nothing is posted', picked.tiles.join('|') === 'Pip' && picked.text === '' && (await room()).posts.length === 2, JSON.stringify(picked))
  await type('Which fruit did Wren name in reply to my first post in this room? One word, or unknown if you were not told.')
  await drive.capture('Pip in the box, the question typed', () => drive.evaluate(BOX))
  await enter()
  const third = await settled(2, 1)
  say(`post three: ${JSON.stringify(third)}`)
  const pipAnswer = third?.answers?.find((answer) => answer.teammateId === 'tm_pip')
  check('post three ran Pip alone', (third?.answers ?? []).map((answer) => answer.teammateId).join('|') === 'tm_pip', JSON.stringify(third?.answers?.map((answer) => answer.teammateId)))
  check(`Pip knew what Wren named first (${fruits.tm_wren})`, fruits.tm_wren !== undefined && (pipAnswer?.text ?? '').toLowerCase().includes(fruits.tm_wren), pipAnswer?.text?.slice(0, 200))

  // 4. "@wren " becomes a tile by itself; Backspace at the start takes it off.
  await focusBox()
  await type('@wren ')
  const typedName = await boxState()
  check('"@wren " becomes the Wren tile with nothing left in the text', typedName.tiles.join('|') === 'Wren' && typedName.text === '', JSON.stringify(typedName))
  await press('Backspace', 'Backspace', 8)
  const removed = await boxState()
  check('Backspace at the start takes the tile off: everyone again', removed.tiles.length === 0 && removed.placeholder === 'Post to pair…', JSON.stringify(removed))

  const age = String(await drive.evaluate(`(() => (document.querySelector('.lc-conv--room .lc-conv__age')?.textContent ?? '').trim())()`))
  check('the sidebar says the room was just used', /^(now|[1-9]m|[1-5][0-9]m)$/.test(age), `"${age}"`)
  await drive.capture('the room after three posts', () => drive.evaluate(READ))
  say(failures === 0 ? '\nROOM ASK ONE PASSED' : `\nROOM ASK ONE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `A room of two on OpenCode's free models -- Wren on ${WREN_MODEL}, Pip on ${PIP_MODEL} -- read-only, relay off, typed into with real key events. Post one to both; Reply on Wren's answer for post two; "@P" + Enter for post three, asking Pip what Wren named first; then "@wren " and Backspace.`
  })
}
