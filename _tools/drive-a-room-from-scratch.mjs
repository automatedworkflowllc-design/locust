// Fresh-eyes area 10: Rooms, as a person meets them.
//
//   node _tools/drive-a-room-from-scratch.mjs [--packaged <exe>] [--tag <name>]
//
// The everyday profile (everyday-ledger.mjs), its four teammates on a free
// model. From the Rooms screen: make a room of two, post one question, read
// both answers, then the answer cards' controls, the room in the sidebar and
// on the Rooms screen, and the room at 1120 and 1920. Free model, Ask.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('a-room-from-scratch-2026-09-27'), `a-room-from-scratch-${tag}`)
await mkdir(OUT, { recursive: true })

const everyday = await seedEverydayLedger('room-scratch')
const route = { ...FREE_ROUTE, mode: 'ask' }
const seed = { ...everyday.seed, teammates: everyday.seed.teammates.map((teammate) => ({ ...teammate, route })) }
const drive = await startDrive({
  name: `room-scratch-${tag}`, port: 9745, workspace: everyday.workspace, profilePath: everyday.profilePath, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed
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
const READ = `JSON.stringify([...document.querySelectorAll('.lc-roompost')].map((section) => [...section.querySelectorAll('.lc-roomanswer')].map((card) => ({
  teammateId: (card.getAttribute('data-answer') ?? ':').split(':')[1],
  phase: (card.querySelector('.lc-roomanswer__phase')?.textContent ?? '').trim(),
  text: card.innerText.replace(/\\s+/g, ' '),
  actions: [...card.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean)
}))))`
const posts = async () => JSON.parse(String(await drive.evaluate(READ)))
const settled = async (index, expected) => {
  for (let waited = 0; waited < 300_000; waited += 2000) {
    await sleep(2000)
    const post = (await posts())[index]
    if (post !== undefined && post.length >= expected && post.every((answer) => answer.phase.length > 0 && !/^(asked|running|working|thinking)/i.test(answer.phase))) break
  }
  await sleep(4000)
  return (await posts())[index] ?? []
}
const openRooms = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Rooms/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  return document.querySelector('.lc-screen')?.innerText.replace(/\\s+/g, ' ') ?? ''
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  const empty = String(await drive.capture('Rooms, before there are any', () => drive.evaluate(openRooms)))
  say(`  rooms screen: ${empty.slice(0, 300)}`)
  check('the Rooms screen says what a room is and how to make one', /room/i.test(empty) && document_has_form(empty), empty.slice(0, 160))

  const made = String(await drive.capture('make a room: Launch plan, Atlas and Quill', () => drive.evaluate(`(async () => {
    const field = document.querySelector('.lc-roomform__name')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(field, 'Launch plan')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    for (const name of ['Atlas', 'Quill']) [...document.querySelectorAll('.lc-roomform__members [role=checkbox]')].find((chip) => chip.innerText.includes(name))?.click()
    await new Promise((r) => setTimeout(r, 300))
    const submit = document.querySelector('.lc-roomform button[type=submit]')
    const said = submit?.innerText ?? ''
    submit?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return JSON.stringify({ said, screen: document.querySelector('.lc-screen, .lc-room')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? '', box: !!document.querySelector('.lc-roomcompose__box') })
  })()`)))
  say(`  made: ${made}`)
  check('Create room opens the room, ready to post', JSON.parse(made).box === true, made)

  await drive.evaluate(`document.querySelector('.lc-roomcompose__box')?.focus()`)
  await type('In one short sentence each: what is the one thing you would check on the new pricing page before it goes live? Change nothing.')
  await enter()
  const first = await settled(0, 2)
  await drive.capture('both answered', () => drive.evaluate(READ))
  for (const answer of first) say(`    ${answer.teammateId} [${answer.phase}]: ${answer.text.slice(0, 200)} || ${JSON.stringify(answer.actions)}`)
  // The phase, not the length of the card: a provider's error is long too.
  check('both teammates answered', first.length === 2 && first.every((answer) => /^(completed|answered|done)/i.test(answer.phase)), JSON.stringify(first.map((answer) => answer.phase)))
  check('each answer offers Build on and Merge', first.every((answer) => answer.actions.includes('Build on') && answer.actions.includes('Merge')), JSON.stringify(first.map((answer) => answer.actions)))

  const side = String(await drive.evaluate(`JSON.stringify({ sidebar: [...document.querySelectorAll('.lc-convrow')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 4) })`))
  say(`  sidebar: ${side}`)
  check('the room leads the sidebar list', /Launch plan/.test(JSON.parse(side).sidebar[0] ?? ''), side)

  const listed = String(await drive.capture('the Rooms screen, with the room', () => drive.evaluate(openRooms)))
  say(`  rooms screen after: ${listed.slice(0, 300)}`)
  // The room's own card, not the screen: the New room form below it names every teammate.
  const card = String(await drive.evaluate(`[...document.querySelectorAll('.lc-screen .lc-roomcard')].find((r) => /Launch plan/.test(r.innerText))?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  say(`  room card: ${card}`)
  check('the Rooms screen lists it, naming who is in it', /Launch plan/.test(card) && /Atlas/.test(card) && /Quill/.test(card), card)

  await drive.evaluate(`(async () => { ;[...document.querySelectorAll('.lc-roomcard, .lc-roomrow')].find((r) => /Launch plan/.test(r.innerText))?.click(); await new Promise((r) => setTimeout(r, 900)) })()`)
  for (const [w, h] of [[1120, 760], [1920, 1080]]) {
    await drive.resize(w, h)
    await sleep(1500)
    const at = JSON.parse(String(await drive.capture(`the room, ${String(w)}`, () => drive.evaluate(`JSON.stringify({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      answers: document.querySelectorAll('.lc-roomanswer').length,
      box: !!document.querySelector('.lc-roomcompose__box')
    })`))))
    check(`at ${String(w)}: the room is whole, nothing scrolls sideways`, at.overflow <= 0 && at.answers === 2 && at.box, JSON.stringify(at))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. The everyday profile, teammates on ${route.model}, Ask.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

function document_has_form(text) {
  return /create room|new room|name/i.test(text)
}
