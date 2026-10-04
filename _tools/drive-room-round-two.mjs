// Rooms, round two (0.399): answers side by side, Merge, Build on.
//
//   node _tools/drive-room-round-two.mjs [--packaged <exe>] [--tag <name>]
//
// Free models. Wren and Pip each name a fruit; then:
//   1. Side by side puts their answers in one row;
//   2. Merge on Wren's answer writes the next post to Wren alone -- sent, Wren
//      alone answers, and the merge names BOTH fruits (the room's history is
//      how Wren knows Pip's);
//   3. Build on Pip's answer writes the next post to everyone, unsent.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('room-round-two-2026-09-27'), `room-round-two-${tag}`)
await mkdir(OUT, { recursive: true })
const now = '2026-09-27T05:00:00.000Z'
const route = { ...FREE_ROUTE, mode: 'ask' }
const drive = await startDrive({
  name: `room-round-two-${tag}`,
  port: 9709,
  workspace: await scratchRepository('locust-room-round-two-ws-'),
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route },
      { teammateId: 'tm_pip', name: 'Pip', hue: 'violet', role: 'Docs & QA', createdAt: now, route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: { 'rooms.json': { schemaVersion: 1, rooms: [{ roomId: 'rm_pair', name: 'pair', teammateIds: ['tm_wren', 'tm_pip'], createdAt: now, posts: [] }] } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const type = async (text) => {
  for (const character of text) await drive.send('Input.insertText', { text: character })
  await sleep(300)
}
const enter = async () => {
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(400)
}
const BOX = `JSON.stringify({ tiles: [...document.querySelectorAll('.lc-askto__tile')].map((tile) => tile.innerText.trim()), text: document.querySelector('.lc-roomcompose__box')?.value ?? '', focused: document.activeElement === document.querySelector('.lc-roomcompose__box') })`
const READ = `JSON.stringify([...document.querySelectorAll('.lc-roompost')].map((section) => [...section.querySelectorAll('.lc-roomanswer')].map((card) => ({
  teammateId: (card.getAttribute('data-answer') ?? ':').split(':')[1],
  phase: (card.querySelector('.lc-roomanswer__phase')?.textContent ?? '').trim(),
  text: card.innerText.replace(/\\s+/g, ' '),
  box: (() => { const r = card.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] })()
}))))`
const posts = async () => JSON.parse(String(await drive.evaluate(READ)))
const settled = async (index, expected) => {
  for (let waited = 0; waited < 300_000; waited += 2000) {
    await sleep(2000)
    const post = (await posts())[index]
    if (post !== undefined && post.length >= expected && post.every((answer) => answer.phase.length > 0 && !/^(asked|running)/.test(answer.phase))) break
  }
  await sleep(4000)
  return (await posts())[index] ?? []
}
const FRUIT = /\b(apple|apricot|avocado|banana|blackberry|blueberry|cherry|coconut|cranberry|date|fig|grape|grapefruit|guava|kiwi|lemon|lime|lychee|mango|melon|nectarine|orange|papaya|peach|pear|pineapple|plum|pomegranate|raspberry|strawberry|tangerine|watermelon)\b/i

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim() === 'Rooms')?.click()
    await new Promise((r) => setTimeout(r, 1000))
    ;[...document.querySelectorAll('.lc-roomcard, .lc-roomrow')].find((r) => /pair/.test(r.innerText))?.click()
    await new Promise((r) => setTimeout(r, 900))
  })()`)
  await drive.evaluate(`document.querySelector('.lc-roomcompose__box')?.focus()`)
  await type('Wren, name one red fruit. Pip, name one yellow fruit. Reply with that single word and nothing else. Change nothing.')
  await enter()
  const first = await settled(0, 2)
  const fruits = Object.fromEntries(first.map((answer) => [answer.teammateId, FRUIT.exec(answer.text)?.[1]?.toLowerCase()]))
  // Two different fruits, or the merge check below passes with half a merge.
  check('both named a fruit, not the same one', fruits.tm_wren !== undefined && fruits.tm_pip !== undefined && fruits.tm_wren !== fruits.tm_pip, JSON.stringify(fruits))

  await drive.capture('Side by side', async () => {
    await drive.evaluate(`document.querySelector('button[aria-label="Answers side by side"]')?.click()`)
    await sleep(500)
    return drive.evaluate(READ)
  })
  const across = (await posts())[0] ?? []
  check('side by side puts the two answers in one row', across.length === 2 && across[0].box[1] === across[1].box[1] && across[0].box[0] !== across[1].box[0], JSON.stringify(across.map((answer) => answer.box)))

  await drive.evaluate(`[...document.querySelectorAll('.lc-roomanswer[data-answer$=":tm_pip"] button')].find((b) => b.innerText.trim() === 'Build on')?.click()`)
  await sleep(400)
  const built = JSON.parse(String(await drive.evaluate(BOX)))
  check('Build on writes the next post to everyone, unsent', built.tiles.length === 0 && built.text === 'Build on Pip’s answer above: ' && built.focused, JSON.stringify(built))

  await drive.evaluate(`[...document.querySelectorAll('.lc-roomanswer[data-answer$=":tm_wren"] button')].find((b) => b.innerText.trim() === 'Merge')?.click()`)
  await sleep(400)
  const merging = JSON.parse(String(await drive.capture('Merge writes the post to Wren alone', () => drive.evaluate(BOX))))
  check('Merge writes the next post to Wren alone, unsent', merging.tiles.join('|') === 'Wren' && merging.text.startsWith('Merge the answers to my last post into one') && merging.focused, JSON.stringify(merging))
  await enter()
  const merged = await settled(1, 1)
  const text = merged[0]?.text ?? ''
  check('sent: Wren alone answers', merged.map((answer) => answer.teammateId).join('|') === 'tm_wren', JSON.stringify(merged.map((answer) => answer.teammateId)))
  check('and the merge names both fruits', new RegExp(`\\b${fruits.tm_wren}\\b`, 'i').test(text) && new RegExp(`\\b${fruits.tm_pip}\\b`, 'i').test(text), text.slice(0, 240))
  await drive.capture('the merged answer', () => text)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren and Pip on a free model, in Ask.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
