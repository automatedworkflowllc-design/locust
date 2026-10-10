// An arena round on the five paid models, as round 4 ran it (drive-arena-round-4.mjs), for any prompt.
//
//   node _tools/drive-arena-round.mjs --round portrait|worst|trails --set trio|pair|fable --packaged <exe> --prompt <file> [--kit <dir> --lock <LOCKED.md>]
//   LOCUST_SPEND=1 node _tools/drive-arena-round.mjs ... --send          one run, no re-rolls
//
// Colin approved these rounds on 2026-10-09 (in the site session, Beta/Promo: "yes sounds good"), which gave the
// prompts and the lineup: trio = Opus 5.5, Sonnet 5.5, GPT-6.1-Sol; pair = Fable 5.1 + GPT-6-Astra, run LAST;
// fable = Fable 5.1 beside Muse Spark Free, a filler column whose work is NOT counted, for when Astra is skipped
// (a Blind compare needs two). The prompt is read word for word from --prompt, so it cannot drift. High effort,
// Auto, Blind, each column its own fresh copy under the drive's profile, sent once. A limit or an error STOPS
// it: no retry. Any question is DENIED. Every column is copied out byte for byte, and Locust's own record kept,
// before Keep and before anything opens a page.
//
// trails (the bot tournament): the folder every column starts from is a fresh copy of the kit's files, no git,
// each checked against LOCKED.md first; the other rounds start from an empty folder.

import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { requiredPathArgument } from './required-path-argument.mjs'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const SEND = process.argv.includes('--send')
const SET = arg('--set')
const ROUND = arg('--round')
if (SET !== 'trio' && SET !== 'pair' && SET !== 'fable') throw new Error('--set trio, pair or fable')
/** Each round's prompt opens with these words and ends with the same sentence: the wrong file stops it. */
const OPENS = {
  portrait: 'Make a self-portrait in a single self-contained file, index.html.',
  worst: 'Make the most annoying volume control you can, in a single self-contained file, index.html.',
  trails: 'Write a bot for Trails, a light-cycle game.'
}
if (!Object.hasOwn(OPENS, ROUND ?? '')) throw new Error('--round portrait, worst or trails')
const promptPath = requiredPathArgument('--prompt')
const OUT = join(recordRoot(`arena-${ROUND}-2026-10-10`), `${SEND ? 'run' : 'look'}-${SET}`)
await mkdir(OUT, { recursive: true })
const PROMPT = (await readFile(promptPath, 'utf8')).replace(/\r\n/g, '\n').trim()
if (!PROMPT.startsWith(OPENS[ROUND]) || !PROMPT.endsWith('You decide everything else.')) throw new Error(`could not read the ${ROUND} prompt`)
/** What each column must be, read off its own chip before anything is sent. */
const WANT = SET === 'trio'
  ? [
      { search: 'opus', row: /^Opus 5\.5$/i, runtime: /^Claude Code/i },
      { search: 'sonnet', row: /^Sonnet 5\.5$/i, runtime: /^Claude Code/i },
      { search: 'sol', row: /^GPT-6\.1-Sol$/i, runtime: /^Codex/i }
    ]
  : SET === 'pair'
    ? [
        { search: 'fable', row: /^Fable 5\.1$/i, runtime: /^Claude Code/i },
        { search: 'astra', row: /^GPT-6-Astra$/i, runtime: /^Codex/i }
      ]
    : [
        { search: 'fable', row: /^Fable 5\.1$/i, runtime: /^Claude Code/i },
        { search: 'muse spark', row: /^Muse Spark 1\.3 Contributor Free$/i, runtime: /^OpenCode/i }
      ]

const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

const workspace = await mkdtemp(join(tmpdir(), `locust-arena-${ROUND}-`))
if (ROUND === 'trails') {
  // The kit's files only, each one the locked one.
  const kit = requiredPathArgument('--kit')
  const lock = await readFile(requiredPathArgument('--lock'), 'utf8')
  for (const name of await readdir(kit)) {
    const bytes = await readFile(join(kit, name))
    const line = lock.split('\n').find((row) => row.replace(/^-\s*/, '').startsWith(`${name} `))
    if (line === undefined || !line.includes(sha(bytes))) throw new Error(`${name} is not the locked file: nothing set up`)
    await writeFile(join(workspace, name), bytes)
  }
  note(`kit: ${(await readdir(workspace)).join(', ')} -- each matches LOCKED.md`)
}

const drive = await startDrive({
  name: `arena-${ROUND}-${SET}-${SEND ? 'run' : 'look'}`, port: 9876, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  ...(SEND ? { spends: true } : { sendsNothing: true }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
const shot = async (file) => {
  const picture = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (picture?.result?.data) await writeFile(join(OUT, file), Buffer.from(picture.result.data, 'base64'))
}
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
  // A model already in one column is greyed out in the other's picker: a column that could not be set is tried
  // again once the others are.
  const pickColumn = async (index, want) => JSON.parse(String(await drive.evaluate(`(async () => {
      const groups = document.querySelectorAll('.lc-slotgroup')
      if (${String(index)} < groups.length) groups[${String(index)}].querySelector('.lc-control--slot')?.click()
      else if (${String(index)} === 2) document.querySelector('button[aria-label="Add a third model"]')?.click()
      else return JSON.stringify({ picked: null, all: [], why: 'no column ${String(index + 1)}' })
      await new Promise((r) => setTimeout(r, 700))
      let box = document.querySelector('.lc-picker__input')
      for (let i = 0; i < 20 && !box; i += 1) { await new Promise((r) => setTimeout(r, 250)); box = document.querySelector('.lc-picker__input') }
      if (!box) return JSON.stringify({ picked: null, all: [], why: 'no picker for column ${String(index + 1)}' })
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, ${JSON.stringify(want.search)})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 900))
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
  let pending = [...WANT.entries()]
  for (let pass = 1; pass <= 2 && pending.length > 0; pass += 1) {
    const still = []
    for (const [index, want] of pending) {
      const one = await pickColumn(index, want)
      note(`pass ${String(pass)}, column ${String(index + 1)} "${want.search}": picked ${String(one.picked)}${one.why ? ' -- ' + one.why : ''}`)
      note(`  offered: ${JSON.stringify(one.all.map((row) => row.group.slice(0, 14) + ' | ' + row.label + ' (' + row.detail + ')' + (row.disabled ? ' [greyed]' : '')))}`)
      if (one.picked === null) {
        still.push([index, want])
        await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        await sleep(500)
      }
    }
    pending = still
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
  // Auto: each column works in its own copy without asking.
  const mode = String(await drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Permission mode"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('[role="menu"][aria-label="What the comparison does"] [role="menuitemradio"]')]
    const offered = items.map((b) => b.innerText.replace(/\\s+/g, ' ').trim())
    items.find((b) => /^Auto/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 500))
    return JSON.stringify({ offered, mode: document.querySelector('button[aria-label="Permission mode"]')?.innerText.trim() ?? '?', chat: document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? '' })
  })()`))
  note(`mode: ${mode}`)
  await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)
  const columns = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-slotgroup')].map((group) => ({
    model: group.querySelector('.lc-control--slot .lc-control__model')?.textContent.trim() ?? '',
    title: group.querySelector('.lc-control--slot')?.getAttribute('title') ?? '',
    effort: group.querySelector('.lc-control--sloteffort')?.getAttribute('aria-label') ?? ''
  })))`)))
  note(`columns as set: ${JSON.stringify(columns)}`)
  await shot('set-up.png')
  // Nothing is spent unless every column is exactly what was asked, and no limit is used up.
  const ok = columns.length === WANT.length && WANT.every((want, at) => want.row.test(columns[at]?.model ?? '') && want.runtime.test(columns[at]?.title ?? '') && (/: High$/.test(columns[at]?.effort ?? '') || (want.runtime.test('OpenCode') && (columns[at]?.effort ?? '') === ''))) && /^Auto/.test(JSON.parse(mode).mode) && /Blind/.test(JSON.parse(mode).chat)
  const spent = columns.some((column) => /limit is used up/i.test(column.title))
  note(ok ? 'SET UP AS ASKED' : 'NOT SET UP AS ASKED: nothing sent')
  if (spent) note('A LIMIT IS USED UP: nothing sent')
  if (!ok || !SEND || spent) stop = spent ? 'limit used up' : ok ? 'look only' : 'not as asked'
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
    // Two hours at most: a bot's author may test for a long time.
    for (let second = 0; second < 7200; second += 2) {
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
      if (view.states.length === WANT.length && Object.keys(doneAt).length === WANT.length) break
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
    if (/usage limit|hit your limit|rate limit|could not be written|failed/i.test(JSON.stringify(blindView))) note('LIMIT OR FAILURE SEEN: stop here and tell Colin; nothing is retried')
    if (!shotRunning) await shot('blind-running.png')
    await shot('blind-done.png')
    const profileCompares = JSON.parse(await readFile(join(drive.profile, 'compares.json'), 'utf8'))
    await writeFile(join(OUT, 'compares.json'), JSON.stringify(profileCompares, null, 2))
    await writeFile(join(OUT, 'timing.json'), JSON.stringify({ sentAt: new Date(sentAt).toISOString(), doneAt, denied }, null, 2))
    // The record first: a failure further down must not cost it.
    await cp(join(drive.profile, 'mission-ledger'), join(OUT, 'mission-ledger'), { recursive: true }).catch((error) => note(`ledger not copied: ${String(error)}`))
    // Every column's folder, byte for byte, BEFORE Keep (which removes the others' copies) and before anything opens a page.
    const compare = (profileCompares.compares ?? profileCompares).at(-1)
    const files = {}
    for (const slot of compare.slots) {
      const inProfile = join(drive.profile, 'compare', `${compare.compareId}-${slot.slot}`)
      const from = (await stat(inProfile).then(() => true, () => false)) ? inProfile : join(homedir(), '.locust', 'compare', `${compare.compareId}-${slot.slot}`)
      const to = join(OUT, 'columns', slot.slot)
      await cp(from, to, { recursive: true, preserveTimestamps: true })
      const walk = async (dir, base = '') => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (entry) => entry.isDirectory()
        ? walk(join(dir, entry.name), `${base}${entry.name}/`)
        : [{ name: `${base}${entry.name}`, bytes: (await stat(join(dir, entry.name))).size, sha256: sha(await readFile(join(dir, entry.name))) }]))).flat()
      files[slot.slot] = { route: slot.route, missionIds: slot.missionIds, from, files: await walk(to) }
    }
    await writeFile(join(OUT, 'columns.json'), JSON.stringify(files, null, 2))
    note(`copied out: ${JSON.stringify(Object.fromEntries(Object.entries(files).map(([slot, one]) => [slot, one.files.filter((file) => !file.name.includes('/')).map((file) => file.name + ' ' + String(file.bytes))])))}`)
    await cp(join(drive.profile, 'mission-ledger'), join(OUT, 'mission-ledger'), { recursive: true, force: true }).catch((error) => note(`ledger not copied: ${String(error)}`))
    // Locust's guard (0.717): every command it refused, column by column, from the record.
    let guarded = 0
    for (const file of (await readdir(join(OUT, 'mission-ledger')).catch(() => [])).filter((name) => name.endsWith('.jsonl'))) {
      for (const line of (await readFile(join(OUT, 'mission-ledger', file), 'utf8')).split('\n')) {
        if (!line.includes('Locust stopped this command before it ran')) continue
        try {
          const event = JSON.parse(line).event
          if (event?.type === 'tool.failed' && event.payload?.status === 'refused') { guarded += 1; note(`guard refused in ${file}: ${String(event.payload.command ?? '').slice(0, 200)}`) }
        } catch { /* a partial line */ }
      }
    }
    note(`guard refusals: ${String(guarded)}`)
    // The reveal: Keep on the first column (not a choice -- the first), then the named view.
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
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Arena ${ROUND}, ${SET} set, ${SEND ? 'run' : 'set up only'}.`, extra: notes.join('\n') })
}
