// Notes on a diff, sent as one message (0.376).
//
//   node _tools/drive-diff-notes.mjs [--packaged <exe>] [--tag <name>]
//
// A teammate's change is reviewed where it is shown: hover a line of the
// diff, press its "+", write a note, and the note waits as one tile in the
// chat box until the next message carries it -- with its file, its line and
// the line itself.
//
// Wren, on a free OpenCode model in Accept edits, changes a port. The drive
// opens the diff, hovers the changed line with the mouse (so the "+" shows),
// presses it, types a note with real key events, adds it with Enter, and
// sends one short message. Wren must then act on the note.
//
// Free model only.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('diff-notes-2026-09-26'), `diff-notes-${tag}`)
await mkdir(OUT, { recursive: true })

const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const workspace = await scratchRepository('locust-diff-notes-ws-')
await writeFile(join(workspace, 'app.js'), "const http = require('http')\n\nconst port = 3000\n\nhttp.createServer((req, res) => res.end('ok')).listen(port)\n")
const drive = await startDrive({
  name: `diff-notes-${tag}`,
  port: 9676,
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); break }
  }
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
  }
  return 'timed out'
})()`)

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(openTeammateScript('Wren'))
  const changed = await send('In app.js, change the port from 3000 to 3001. Change nothing else.')
  const source = await readFile(join(workspace, 'app.js'), 'utf8')
  check('Wren changed the port', changed === 'ended' && /const port = 3001/.test(source), `${String(changed)} || ${source.split('\n')[2]}`)

  // The change, opened where it is shown: the fold, then the file's diff.
  const opened = String(await drive.evaluate(`(async () => {
    const fold = [...document.querySelectorAll('.lc-activity button, .lc-activity [role=button]')].find((b) => /tool call|1 file|edited|ran/i.test(b.innerText))
    if (document.querySelector('.lc-diff') === null) fold?.click()
    await new Promise((r) => setTimeout(r, 600))
    if (document.querySelector('.lc-diff') === null) {
      ;[...document.querySelectorAll('.lc-filerow')].find((row) => /app\\.js/.test(row.innerText))?.click()
      await new Promise((r) => setTimeout(r, 600))
    }
    const line = [...document.querySelectorAll('.lc-diff__row.is-add')].find((row) => /3001/.test(row.innerText))
    if (!line) return 'no added line'
    line.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 300))
    const box = line.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) })
  })()`))
  check('the diff is open at the changed line', opened.startsWith('{'), opened)
  if (!opened.startsWith('{')) throw new Error('no diff to note on')
  const at = JSON.parse(opened)

  // Hover with the mouse: the "+" shows only then.
  await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
  await sleep(400)
  const shown = await drive.capture('hovering the changed line shows its "+"', () => drive.evaluate(`(() => {
    const line = [...document.querySelectorAll('.lc-diff__row.is-add')].find((row) => /3001/.test(row.innerText))
    const plus = line?.querySelector('.lc-diff__noteadd')
    return plus ? getComputedStyle(plus).opacity + ' || ' + plus.getAttribute('aria-label') : 'no plus'
  })()`))
  check('the "+" shows on hover, naming its line', /^1 \|\| Add a note on app\.js, line 3$/.test(String(shown)), String(shown))
  const plusAt = JSON.parse(String(await drive.evaluate(`(() => {
    const plus = [...document.querySelectorAll('.lc-diff__row.is-add')].find((row) => /3001/.test(row.innerText))?.querySelector('.lc-diff__noteadd')
    const box = plus.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) })
  })()`)))
  for (const type of ['mousePressed', 'mouseReleased']) await drive.send('Input.dispatchMouseEvent', { type, x: plusAt.x, y: plusAt.y, button: 'left', clickCount: 1 })
  await sleep(400)
  const editor = String(await drive.evaluate(`(() => { const field = document.querySelector('.lc-diff__noteedit textarea'); return field === null ? 'no editor' : 'focused: ' + String(document.activeElement === field) })()`))
  check('the "+" opens a note under the line, focused', editor === 'focused: true', editor)
  const NOTE = 'Read the port from the PORT environment variable, and fall back to 3001.'
  for (const character of NOTE) await drive.send('Input.insertText', { text: character })
  await drive.capture('the note, typed under its line', () => drive.evaluate(`(() => document.querySelector('.lc-diff__noteedit textarea')?.value ?? '')()`))
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(500)
  const kept = String(await drive.capture('the note under its line, and its tile in the chat box', () => drive.evaluate(`(() => JSON.stringify({
    note: document.querySelector('.lc-diff__notetext')?.textContent ?? '',
    marked: document.querySelector('.lc-diff__row.has-note') !== null,
    tile: document.querySelector('.lc-notestile')?.innerText.trim() ?? ''
  }))()`)))
  const noted = JSON.parse(kept)
  check('the note sits under its line, the line is marked, and the chat box holds "1 note on the changes"', noted.note === NOTE && noted.marked && noted.tile === '1 note on the changes', kept)

  const answered = await send('One note on your change.')
  const sentBubble = String(await drive.evaluate(`(() => [...document.querySelectorAll('.lc-thread .lc-turn__prompt, .lc-thread [data-role=prompt], .lc-bubble')].map((b) => b.innerText).join(' || '))()`))
  const after = await readFile(join(workspace, 'app.js'), 'utf8')
  await drive.capture('Wren, after the note', () => after)
  check('the tile is gone once the message went', String(await drive.evaluate(`(() => document.querySelector('.lc-notestile') === null)()`)) === 'true')
  // 0.395 (Orca's #5): the bubble holds the person's words and the note is
  // drawn under it -- where it was, the line, what was said -- and, once the
  // revision is over, what became of it.
  check('the bubble is the words alone, not the notes block', /One note on your change\./.test(sentBubble) && !/Notes on your changes/.test(sentBubble), sentBubble.slice(0, 300))
  const sentNotes = String(await drive.capture('the note under the message, and what the revision did to its line', () => drive.evaluate(`(() => JSON.stringify([...document.querySelectorAll('.lc-sentnote')].map((row) => ({
    place: row.querySelector('.lc-sentnote__place')?.textContent ?? '',
    code: row.querySelector('.lc-sentnote__code')?.textContent ?? '',
    text: row.querySelector('.lc-sentnote__text')?.textContent ?? '',
    outcome: row.querySelector('.lc-sentnote__outcome')?.textContent ?? ''
  }))))()`)))
  const drawn = JSON.parse(sentNotes)
  check('the note survives under the message, with its place, line and words', drawn.length === 1 && drawn[0].place === 'app.js:3' && drawn[0].code === 'const port = 3001' && drawn[0].text === NOTE, sentNotes)
  check('Wren acted on the note', answered === 'ended' && /process\.env\.PORT/.test(after), after.split('\n').filter((line) => /port/i.test(line)).join(' / '))
  check('and the note says its line changed', drawn[0]?.outcome === 'Line changed', drawn[0]?.outcome)
  say(failures === 0 ? '\nDIFF NOTES PASSED' : `\nDIFF NOTES: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Wren on ${MODEL}, Accept edits. Changes a port; the drive hovers the changed line, pins a note with key events, and sends it with one short message.` })
}
