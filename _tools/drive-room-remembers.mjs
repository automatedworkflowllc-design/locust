// A room remembers what was said (0.370).
//
//   LOCUST_SPEND=1 node _tools/drive-room-remembers.mjs [--packaged <exe>] [--tag <name>]
//
// Every room post used to start each member cold: the post and the board,
// nothing else. So a second post that builds on the first -- "say more about
// your second point" -- reached teammates who had never seen their own first
// answer. From 0.370 each member is told the room's earlier posts and the
// answers that finished (shared/room-history.ts).
//
// Two teammates on two of OpenCode's free models, read-only, relay off. The
// first post asks each to name a fruit. The second asks each what BOTH of
// them named, and to write "unknown" rather than guess. Only a member told
// the room so far can answer it; run against a build before 0.370 this drive
// is the control, and its checks are expected to fail.
//
// Free models only: nothing is spent. LOCUST_SPEND=1 is still required,
// because it is still a model being run.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('room-remembers-2026-09-26'), `room-remembers-${tag}`)
await mkdir(OUT, { recursive: true })

const WREN_MODEL = process.env.LOCUST_ROOM_MODEL_A ?? 'opencode/nemotron-3-ultra-free'
const PIP_MODEL = process.env.LOCUST_ROOM_MODEL_B ?? 'opencode/longcat-2.5-preview-free'

const workspace = await scratchRepository('locust-room-remembers-ws-')
const now = '2026-09-26T05:00:00.000Z'
const drive = await startDrive({
  name: `room-remembers-${tag}`,
  port: 9671,
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

// Post into the open room, the way a person does: the room's own box.
const post = (text) =>
  drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    if (box === null) return 'no room composer'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, ${JSON.stringify(text)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    document.querySelector('.lc-roomcompose').requestSubmit()
    return 'posted'
  })()`)

// Every answer card on screen: which post, who, its state, and what it says
// below its header -- the words a person reads on the card.
const READ = `(() => JSON.stringify([...document.querySelectorAll('.lc-roomanswer')].map((card) => {
  const [postId, teammateId] = (card.getAttribute('data-answer') ?? ':').split(':')
  const who = card.querySelector('.lc-roomanswer__who')
  const phase = (card.querySelector('.lc-roomanswer__phase')?.textContent ?? '').trim()
  const all = (card.innerText ?? '').replace(/\\s+/g, ' ').trim()
  const head = (who?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  return { postId, teammateId, phase, text: all.startsWith(head) ? all.slice(head.length).trim() : all }
})))()`

const finished = (answer) => answer.phase.length > 0 && !/^(asked|running)/.test(answer.phase)

// The answers to the Nth post (0-based), once both members are done.
async function answersTo(index, patienceMs) {
  let answers = []
  for (let waited = 0; waited < patienceMs; waited += 2000) {
    await sleep(2000)
    const all = JSON.parse(String(await drive.evaluate(READ)))
    const posts = [...new Set(all.map((answer) => answer.postId))]
    const mine = all.filter((answer) => answer.postId === posts[index])
    answers = mine
    if (mine.length >= 2 && mine.every(finished)) break
  }
  return answers
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

  const first = await drive.capture('first post: name a fruit', () =>
    post('Each of you, name one fruit. Reply with that single word and nothing else. Change nothing.')
  )
  check('the first post went to the room', String(first) === 'posted', String(first))
  const named = await answersTo(0, 300_000)
  say(`first answers: ${JSON.stringify(named)}`)
  const fruits = Object.fromEntries(named.map((answer) => [answer.teammateId, fruitOf(answer.text)]))
  const wrenFruit = fruits.tm_wren
  const pipFruit = fruits.tm_pip
  check('both named a fruit', wrenFruit !== undefined && pipFruit !== undefined, JSON.stringify(fruits))
  if (wrenFruit === undefined || pipFruit === undefined) throw new Error('no fruit to ask about')

  const second = await drive.capture('second post: what did each of you name?', () =>
    post(
      'Which fruit did each of you name in reply to my previous post in this room? Do not guess: if you were not told, write unknown. Answer in one line, exactly: Wren=<fruit>, Pip=<fruit>. Change nothing.'
    )
  )
  check('the second post went to the room', String(second) === 'posted', String(second))
  const recalled = await answersTo(1, 300_000)
  await sleep(1500)
  await drive.capture('both answers to the second post', () => drive.evaluate(READ))
  say(`second answers: ${JSON.stringify(recalled)}`)
  for (const [teammateId, name] of [['tm_wren', 'Wren'], ['tm_pip', 'Pip']]) {
    const answer = recalled.find((candidate) => candidate.teammateId === teammateId)
    const text = (answer?.text ?? '').toLowerCase()
    check(
      `${name} knew both fruits (Wren=${wrenFruit}, Pip=${pipFruit})`,
      answer !== undefined && text.includes(wrenFruit) && text.includes(pipFruit),
      answer === undefined ? 'no answer' : answer.text.slice(0, 200)
    )
  }
  // The sidebar's row for the room is as old as its last post, not its
  // making: the room was seeded at 05:00 and read "15h" on 0.369 and 0.370.
  const age = String(await drive.evaluate(`(() => (document.querySelector('.lc-conv--room .lc-conv__age')?.textContent ?? '').trim())()`))
  check('the sidebar says the room was just used', /^(now|[1-9]m|[1-5][0-9]m)$/.test(age), `"${age}"`)
  say(failures === 0 ? '\nROOM REMEMBERS PASSED' : `\nROOM REMEMBERS: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `A room of two on OpenCode's free models -- Wren on ${WREN_MODEL}, Pip on ${PIP_MODEL} -- read-only, relay off. Post one: name a fruit. Post two: what did each of you name? Only a member told the room so far can answer.`
  })
}
