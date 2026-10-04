// Arena round 2: three models build the same landing page, names hidden (2026-10-04).
//
//   node _tools/drive-arena-round-2.mjs --packaged <exe>                      sets it up and stops; sends nothing
//   LOCUST_SPEND=1 node _tools/drive-arena-round-2.mjs --packaged <exe> --send  one run, no re-rolls
//
// Round 1's drive (drive-blind-arena.mjs) with round 2's prompt and models, as the promo
// session asked on 2026-10-04 and Colin approved ("reset is tonight. we can even include
// fable as well"): Claude Code Opus 5.5, Claude Code Sonnet 5.5 and Codex GPT-6.1-Sol, all
// High, Auto, in one Blind compare. Fable 5.1 runs alone after (drive-arena-round-2-fable.mjs):
// a compare holds three. The notes below are round 1's and hold here too.
//
// docs/HANDOFF-blind-arena-run.md (the promo session's): Compare -> Blind,
// Claude Code Sonnet 5.5 (high), Claude Code Opus 5.5 (high), Codex GPT-6 Sol
// (high), each picked from the picker, never Account default. The exact prompt,
// once, to all three. Edit, so each column writes in its own copy of an empty
// folder without asking; anything it does ask is DENIED here (this drive never
// approves a tool call) and written down. Screenshots of the blind view mid-run
// and after the reveal, at 1200x780. The games are copied out by hand after,
// byte for byte, before anything opens them.

import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const SEND = process.argv.includes('--send')
const OUT = join(recordRoot('arena-round-2-2026-10-05'), SEND ? 'run' : 'look')
await mkdir(OUT, { recursive: true })
const PROMPT = `Make a landing page for a made-up coffee subscription brand (invent the name) in a single self-contained file, index.html. No libraries, no external images, fonts or scripts, and no network requests.

It must look great on a desktop and on a phone, and fit any screen width without sideways scrolling. Include a hero, a "how it works" section, three plans with prices, and a signup form that shows a thank-you message when submitted (no real submission).

You decide the style.`
// What each column must be, read off its own chip before anything is sent.
const WANT = [
  { search: 'opus', row: /^Opus 5\.5$/i, runtime: /^Claude Code/i },
  { search: 'sonnet', row: /^Sonnet 5\.5$/i, runtime: /^Claude Code/i },
  { search: 'sol', row: /^GPT-6\.1-Sol$/i, runtime: /^Codex/i }
]

// An empty folder, not a git project, nothing above it that instructs a model: each column edits its own copy.
const workspace = await mkdtemp(join(tmpdir(), 'locust-arena-2-'))
const drive = await startDrive({
  name: `arena-2-${SEND ? 'run' : 'look'}`, port: 9873, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  ...(SEND ? { spends: true } : { sendsNothing: true }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
const shot = async (file) => {
  const picture = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (picture?.result?.data) await writeFile(join(OUT, file), Buffer.from(picture.result.data, 'base64'))
}
const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }
let stop
try {
  await drive.ready()
  await drive.resize(1200, 780)
  await sleep(5000)
  // Blind, from the chat mode chip: it compares the recent pair; each column is then set from its own chip.
  const opened = String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('.lc-control--chatmode'); i += 1) await new Promise((r) => setTimeout(r, 500))
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 500))
    ;[...document.querySelectorAll('.lc-menu[aria-label="Direct or compare"] .lc-menu__item')].find((item) => item.querySelector('.lc-menu__name')?.textContent.trim() === 'Blind')?.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-slotgroup'); i += 1) await new Promise((r) => setTimeout(r, 250))
    const picker = [...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')
    if (picker && !picker.disabled) picker.click()
    await new Promise((r) => setTimeout(r, 600))
    return JSON.stringify({ chat: document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? '', slots: [...document.querySelectorAll('.lc-slotgroup')].map((g) => g.innerText.replace(/\\s+/g, ' ').trim()) })
  })()`))
  note(`blind: ${opened}`)
  await shot('opened.png')
  for (const [index, want] of WANT.entries()) {
    const one = JSON.parse(String(await drive.evaluate(`(async () => {
      const groups = document.querySelectorAll('.lc-slotgroup')
      if (${String(index)} < groups.length) groups[${String(index)}].querySelector('.lc-control--slot')?.click()
      else document.querySelector('button[aria-label="Add a third model"]')?.click()
      await new Promise((r) => setTimeout(r, 700))
      let box = document.querySelector('.lc-picker__input')
      for (let i = 0; i < 20 && !box; i += 1) { await new Promise((r) => setTimeout(r, 250)); box = document.querySelector('.lc-picker__input') }
      if (!box) return JSON.stringify({ picked: null, all: [], why: 'no picker for column ${String(index + 1)}' })
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, ${JSON.stringify(want.search)})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 900))
      // Each row under the runtime heading above it.
      let group = ''
      const all = []
      for (const el of document.querySelectorAll('.lc-picker__group, .lc-picker__row')) {
        if (el.classList.contains('lc-picker__group')) { group = el.textContent.replace(/\\s+/g, ' ').trim(); continue }
        if (el.classList.contains('is-recent')) continue
        all.push({ el, group, label: el.querySelector('.lc-picker__label')?.textContent.trim() ?? '', detail: el.querySelector('.lc-picker__detail')?.textContent.trim() ?? '', disabled: el.disabled })
      }
      const fits = all.filter((row) => !row.disabled && ${want.runtime}.test(row.group) && ${want.row}.test(row.label))
      // A pinned version ("This version, always") over the alias, when both are offered.
      const row = fits.find((one) => /This version/i.test(one.detail)) ?? fits[0]
      row?.el.click()
      await new Promise((r) => setTimeout(r, 700))
      return JSON.stringify({ picked: row === undefined ? null : row.group + ' / ' + row.label + ' / ' + row.detail, all: all.map(({ el, ...rest }) => rest) })
    })()`)))
    note(`column ${String(index + 1)} "${want.search}": picked ${String(one.picked)}${one.why ? ' -- ' + one.why : ''}`)
    note(`  offered: ${JSON.stringify(one.all.map((row) => row.group.slice(0, 14) + ' | ' + row.label + ' (' + row.detail + ')'))}`)
  }
  // High on each column, from its own effort control.
  for (const [index] of WANT.entries()) {
    const set = String(await drive.evaluate(`(async () => {
      const group = document.querySelectorAll('.lc-slotgroup')[${String(index)}]
      if (!group) return 'no column ${String(index + 1)}'
      group.querySelector('.lc-control--sloteffort')?.click()
      await new Promise((r) => setTimeout(r, 500))
      const input = document.querySelector('.lc-compare-slots .lc-effortpanel__slider')
      if (!input) return 'no effort control: ' + group.innerText.replace(/\\s+/g, ' ').trim()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const seen = []
      for (let stop = 0; stop <= Number(input.max); stop += 1) {
        setter.call(input, String(stop))
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 200))
        const now = document.querySelector('.lc-compare-slots .lc-effortpanel__now')?.innerText.trim() ?? ''
        seen.push(now)
        if (/^high$/i.test(now)) break
      }
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      return 'levels ' + seen.join('/') + ' -> ' + group.innerText.replace(/\\s+/g, ' ').trim()
    })()`))
    note(`column ${String(index + 1)} effort: ${set}`)
  }
  // Edit: each column writes in its own copy without asking. Then Blind.
  const mode = String(await drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Permission mode"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('[role="menu"][aria-label="What the comparison does"] [role="menuitemradio"]')]
    const offered = items.map((b) => b.innerText.replace(/\\s+/g, ' ').trim())
    items.find((b) => new RegExp('^' + ${JSON.stringify(process.env.ARENA_MODE ?? 'Auto')}).test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 500))
    return JSON.stringify({ offered, mode: document.querySelector('button[aria-label="Permission mode"]')?.innerText.trim() ?? '?', chat: document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? '' })
  })()`))
  note(`mode: ${mode}`)
  await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)
  // As the chips name them: the model, its runtime (the chip's title), its effort.
  const columns = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-slotgroup')].map((group) => ({
    model: group.querySelector('.lc-control--slot .lc-control__model')?.textContent.trim() ?? '',
    title: group.querySelector('.lc-control--slot')?.getAttribute('title') ?? '',
    effort: group.querySelector('.lc-control--sloteffort')?.getAttribute('aria-label') ?? ''
  })))`)))
  note(`columns as set: ${JSON.stringify(columns)}`)
  await shot('set-up.png')
  // Stop before spending anything unless every column is exactly what was asked.
  const ok = columns.length === 3 && WANT.every((want, at) => want.row.test(columns[at]?.model ?? '') && want.runtime.test(columns[at]?.title ?? '') && /: High$/.test(columns[at]?.effort ?? '')) && new RegExp(process.env.ARENA_MODE ?? 'Auto').test(JSON.parse(mode).mode) && /Blind/.test(JSON.parse(mode).chat)
  note(ok ? 'SET UP AS ASKED' : 'NOT SET UP AS ASKED: nothing sent')
  if (!ok || !SEND) stop = ok ? 'look only' : 'not as asked'
  if (stop === undefined) {
    const sentAt = Date.now()
    await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, ${JSON.stringify(PROMPT)})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
      document.querySelector('button[aria-label="Send"]')?.click()
    })()`)
    note(`sent at ${new Date(sentAt).toISOString()}`)
    const doneAt = {}
    const denied = []
    let shotRunning = false
    for (let second = 0; second < 3600; second += 2) {
      await sleep(2000)
      const view = JSON.parse(String(await drive.evaluate(`JSON.stringify({
        states: [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim()),
        asks: [...document.querySelectorAll('.lc-compare__cell')].map((col, at) => ({ at, ask: [...col.querySelectorAll('button')].find((b) => /^(Deny|Decline)$/.test(b.innerText.trim())) ? col.querySelector('.lc-decision, [class*=decision]')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) ?? 'a question' : null }))
      })`)))
      // Never approve: a question is answered no, and written down.
      for (const one of view.asks.filter((col) => col.ask !== null)) {
        denied.push({ column: one.at + 1, at: Math.round((Date.now() - sentAt) / 1000), asked: one.ask })
        note(`column ${String(one.at + 1)} asked: ${String(one.ask)} -- DENIED`)
        await drive.evaluate(`(() => { const col = [...document.querySelectorAll('.lc-compare__cell')][${String(one.at)}]; [...col.querySelectorAll('button')].find((b) => /^(Deny|Decline)$/.test(b.innerText.trim()))?.click() })()`)
      }
      view.states.forEach((state, at) => {
        if (doneAt[at] === undefined && !/working|waiting|starting/i.test(state) && second > 10) doneAt[at] = { seconds: Math.round((Date.now() - sentAt) / 1000), state }
      })
      if (!shotRunning && second >= 60 && view.states.some((state) => /working/i.test(state))) { await shot('blind-running.png'); shotRunning = true; note(`blind-running.png at ${String(second)}s: ${JSON.stringify(view.states)}`) }
      if (view.states.length === 3 && Object.keys(doneAt).length === 3) break
    }
    note(`done: ${JSON.stringify(doneAt)}`)
    note(`denied: ${JSON.stringify(denied)}`)
    await sleep(3000)
    const blindView = JSON.parse(String(await drive.evaluate(`JSON.stringify({
      heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
      bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      foot: [...document.querySelectorAll('.lc-compare__foot')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())
    })`)))
    note(`blind view at the end: ${JSON.stringify(blindView)}`)
    if (!shotRunning) await shot('blind-running.png')
    await shot('blind-done.png')
    const profileCompares = JSON.parse(await readFile(join(drive.profile, 'compares.json'), 'utf8'))
    await writeFile(join(OUT, 'compares.json'), JSON.stringify(profileCompares, null, 2))
    await writeFile(join(OUT, 'timing.json'), JSON.stringify({ sentAt: new Date(sentAt).toISOString(), doneAt, denied }, null, 2))
    // Every column's folder, byte for byte, BEFORE Keep (which removes the others' copies) and before anything opens a game.
    const compare = (profileCompares.compares ?? profileCompares).at(-1)
    const files = {}
    for (const slot of compare.slots) {
      const from = join(homedir(), '.locust', 'compare', `${compare.compareId}-${slot.slot}`)
      const to = join(OUT, 'columns', slot.slot)
      await cp(from, to, { recursive: true, preserveTimestamps: true })
      const walk = async (dir, base = '') => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (entry) => entry.isDirectory()
        ? walk(join(dir, entry.name), `${base}${entry.name}/`)
        : [{ name: `${base}${entry.name}`, bytes: (await stat(join(dir, entry.name))).size, sha256: createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex') }]))).flat()
      files[slot.slot] = { route: slot.route, missionIds: slot.missionIds, from, files: await walk(to) }
    }
    await writeFile(join(OUT, 'columns.json'), JSON.stringify(files, null, 2))
    note(`copied out: ${JSON.stringify(Object.fromEntries(Object.entries(files).map(([slot, one]) => [slot, one.files.map((file) => file.name + ' ' + String(file.bytes))])))}`)
    // The reveal: Keep on column A (not a choice -- the first), then the named view.
    const revealed = String(await drive.evaluate(`(async () => {
      document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
      for (let i = 0; i < 60 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
      await new Promise((r) => setTimeout(r, 1000))
      document.querySelector('.lc-compared__open')?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return JSON.stringify({
        heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
        foot: [...document.querySelectorAll('.lc-compare__foot')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
        bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      })
    })()`))
    note(`revealed: ${revealed}`)
    await shot('revealed.png')
    stop = 'done'
  }
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'notes.txt'), notes.join('\n') + '\n', 'utf8')
  // Kept open on a run: the reveal and the copies are done by hand, before anything opens a game.
  if (!SEND || stop !== undefined) await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Arena round 2, ${SEND ? 'run' : 'set up only'}.`, extra: notes.join('\n') })
  else say(`LEFT OPEN for the reveal: profile ${drive.profile}; workspace ${workspace}; port 9873`)
}
void readdir
