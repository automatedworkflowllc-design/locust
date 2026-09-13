// Does a conversation recorded before the adapter was fixed read whole now?
//
//   node _tools/probe-an-old-doubled-reply-reads-whole.mjs
//
// A ledger is append-only, so every room answer recorded before 2026-09-12
// still holds the doubled form a Cursor version produced: the closing message
// appended like any other fragment, so the reply says itself twice and the
// next reply is welded onto its end. Colin saw it and asked the right
// question -- "you think this is acceptable?"
//
// It is not, and the record does not have to change: the READER applies the
// same rule the writer now has (`shared/messageFragments.ts`).
//
// This opens his real room, from a copy of his real profile, and asserts no
// answer card says itself twice. SPENDS NOTHING -- it starts no run.

import { cp, mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { say, startDrive } from './drive-lib.mjs'

const HIS = join(process.env.APPDATA ?? '', '@teammate', 'desktop')
const profile = await mkdtemp(join(tmpdir(), 'locust-old-doubled-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
for (const name of await readdir(join(HIS, 'mission-ledger'))) {
  await cp(join(HIS, 'mission-ledger', name), join(profile, 'mission-ledger', name)).catch(() => undefined)
}
for (const file of ['teammates.json', 'workspace.json', 'rooms.json']) {
  await cp(join(HIS, file), join(profile, file)).catch(() => undefined)
}

const drive = await startDrive({
  name: 'an-old-doubled-reply-reads-whole',
  port: 9512,
  workspace: process.cwd(),
  profilePath: profile
})

// No backticks inside these template literals.
const open = `(async () => {
  // Whatever the first room is called: the name is the person's, not ours.
  const room = [...document.querySelectorAll('.lc-row')].find(n => n.innerText.indexOf(' posts') >= 0 || n.innerText.indexOf(' post') >= 0)
  if (room === undefined) return 'no room row'
  room.click()
  await new Promise(r => setTimeout(r, 2500))
  return 'opened ' + String(document.querySelectorAll('.lc-roomanswer__text').length) + ' answer cards'
})()`

const toBottom = `(async () => {
  const scroll = document.querySelector('.lc-screen__scroll, .lc-room__thread')
  if (scroll === null) return 'no scroller'
  scroll.scrollTop = scroll.scrollHeight
  await new Promise(r => setTimeout(r, 1200))
  return 'at the bottom'
})()`

const read = `(async () => {
  const cards = [...document.querySelectorAll('.lc-roomanswer__text')].map(n => n.innerText.trim()).filter(t => t.length > 40)
  // A card says itself twice when its first half equals its second half, and
  // also in the shape that actually occurred: a sentence immediately repeated
  // at the very front, with no separator.
  const doubled = cards.filter(t => {
    const half = t.slice(0, Math.floor(t.length / 2))
    if (t === half + half) return true
    const stop = t.indexOf('.')
    if (stop < 10) return false
    const first = t.slice(0, stop + 1)
    return t.slice(stop + 1, stop + 1 + first.length) === first
  })
  return JSON.stringify({
    cards: cards.length,
    doubledCards: doubled.length,
    heads: cards.slice(0, 3).map(t => t.slice(0, 90))
  }, null, 1)
})()`

try {
  await drive.capture('his own room, reopened from records written before the fix', async () => {
    await drive.ready()
    return drive.evaluate(open)
  })
  await drive.capture('the newest posts, where a teammate actually spoke', () => drive.evaluate(toBottom))
  const seen = await drive.capture('no answer says itself twice', () => drive.evaluate(read))
  const measured = JSON.parse(seen)
  if (measured.cards === 0) say('NOT THE TEST: no answer cards were on screen to read')
  else if (measured.doubledCards > 0) say(`STILL DOUBLED: ${String(measured.doubledCards)} of ${String(measured.cards)} cards`)
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: "Colin's own room, from a copy of his profile. Every answer here was recorded by the Cursor adapter before it learned to recognise a closing message, so the ledger holds the doubled form; the reader repairs it on load."
  })
}
