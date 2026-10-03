// The blind arena's column C, run alone (the promo session's ruling, 2026-10-03).
//
//   node _tools/drive-arena-column-c.mjs --packaged <0.570 exe>                   sets it up and stops; sends nothing
//   LOCUST_SPEND=1 node _tools/drive-arena-column-c.mjs --packaged <exe> --send   one run, no re-rolls
//
// A and B ran together in one Blind compare on 0.570.0. C (Codex GPT-6.1-Sol,
// High) ended 11 s in on Codex's 5-hour limit. A compare needs two models, so
// C runs as an ordinary conversation on the same build: Codex CLI /
// GPT-6.1-Sol / High, Auto, a fresh empty folder, the arena's exact prompt
// (read from drive-blind-arena.mjs, so it cannot drift), once. If it hits the
// limit or Locust errors, it STOPS -- no retry, never another runtime. Any
// question it asks is DENIED (this drive never approves). The folder is copied
// out byte for byte before anything opens the game.

import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const SEND = process.argv.includes('--send')
const OUT = join(recordRoot('blind-arena-2026-10-03'), SEND ? 'run-c' : 'look-c')
await mkdir(OUT, { recursive: true })
const arenaSource = await readFile(new URL('./drive-blind-arena.mjs', import.meta.url), 'utf8')
const PROMPT = /const PROMPT = `([^`]+)`/.exec(arenaSource)?.[1]
if (PROMPT === undefined || !PROMPT.startsWith('Make a small arcade game called "Swarm"')) throw new Error('could not read the arena prompt')

const workspace = await mkdtemp(join(tmpdir(), 'locust-arena-c-'))
const drive = await startDrive({
  name: `arena-c-${SEND ? 'run' : 'look'}`, port: 9872, workspace, outPath: OUT,
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
const chips = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify({
  route: (() => { const b = [...document.querySelectorAll('.lc-control')].find((c) => c.getAttribute('aria-haspopup') === 'listbox'); return b ? { text: b.innerText.replace(/\\s+/g, ' ').trim(), title: b.getAttribute('title') ?? '' } : null })(),
  effort: (() => { const b = [...document.querySelectorAll('button.lc-control')].find((c) => c.querySelector('.lc-control__effort')); return b ? (b.getAttribute('aria-label') ?? '') + ' | ' + b.innerText.replace(/\\s+/g, ' ').trim() : '' })(),
  mode: document.querySelector('button[aria-label="Permission mode"]')?.innerText.trim() ?? '',
  chat: document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? ''
})`)))
let stop
try {
  await drive.ready()
  await drive.resize(1200, 780)
  await sleep(5000)
  // The model, from the picker: under the Codex heading, the GPT-6.1-Sol row, the pinned version when offered.
  const picked = JSON.parse(String(await drive.evaluate(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return JSON.stringify({ picked: null, why: 'no route control' })
    if (!document.querySelector('.lc-picker')) control.click()
    let box = null
    for (let i = 0; i < 20 && !box; i += 1) { await new Promise((r) => setTimeout(r, 250)); box = document.querySelector('.lc-picker__input') }
    if (!box) return JSON.stringify({ picked: null, why: 'no picker' })
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'sol')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    let group = ''
    const all = []
    for (const el of document.querySelectorAll('.lc-picker__group, .lc-picker__row')) {
      if (el.classList.contains('lc-picker__group')) { group = el.textContent.replace(/\\s+/g, ' ').trim(); continue }
      if (el.classList.contains('is-recent')) continue
      all.push({ el, group, label: el.querySelector('.lc-picker__label')?.textContent.trim() ?? '', detail: el.querySelector('.lc-picker__detail')?.textContent.trim() ?? '', disabled: el.disabled })
    }
    const fits = all.filter((row) => !row.disabled && /^Codex/i.test(row.group) && /^GPT-6\\.1-Sol$/i.test(row.label))
    const row = fits.find((one) => /This version/i.test(one.detail)) ?? fits[0]
    row?.el.click()
    await new Promise((r) => setTimeout(r, 700))
    return JSON.stringify({ picked: row === undefined ? null : row.group + ' / ' + row.label + ' / ' + row.detail, all: all.map(({ el, ...rest }) => rest) })
  })()`)))
  note(`model: picked ${String(picked.picked)}${picked.why ? ' -- ' + picked.why : ''}`)
  note(`  offered: ${JSON.stringify((picked.all ?? []).map((row) => row.group.slice(0, 14) + ' | ' + row.label + ' (' + row.detail + ')'))}`)
  // High, from the effort control's own slider.
  const effort = String(await drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button.lc-control')].find((b) => b.querySelector('.lc-control__effort'))
    if (!button) return 'no effort control'
    if (!document.querySelector('.lc-effortpanel')) { button.click(); await new Promise((r) => setTimeout(r, 700)) }
    const slider = document.querySelector('.lc-effortpanel__slider')
    if (!slider) return 'no slider'
    const seen = []
    for (let at = 0; at <= Number(slider.max); at += 1) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(at))
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))
      const now = slider.getAttribute('aria-valuetext') ?? document.querySelector('.lc-effortpanel__now')?.innerText.trim() ?? ''
      seen.push(now)
      if (/^high$/i.test(now)) break
    }
    button.click()
    await new Promise((r) => setTimeout(r, 300))
    return 'levels ' + seen.join('/')
  })()`))
  note(`effort: ${effort}`)
  // Auto, as A and B ran.
  const mode = String(await drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Permission mode"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('[role="menu"][aria-label="Permission mode"] [role="menuitemradio"]')]
    const offered = items.map((b) => b.innerText.replace(/\\s+/g, ' ').trim())
    items.find((b) => b.querySelector('.lc-menu__name')?.textContent.trim() === 'Auto')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return JSON.stringify(offered)
  })()`))
  note(`modes offered: ${mode}`)
  await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)
  const set = await chips()
  note(`as set: ${JSON.stringify(set)}`)
  await shot('c-set-up.png')
  // Stop before spending anything unless the chips say exactly what was asked.
  const ok = /GPT-6\.1-Sol/i.test(set.route?.text ?? '') && /Codex/i.test(`${set.route?.title ?? ''} ${set.route?.text ?? ''}`) && /high/i.test(set.effort) && /^Auto$/.test(set.mode) && !/compare|blind/i.test(set.chat)
  note(ok ? 'SET UP AS ASKED' : 'NOT SET UP AS ASKED: nothing sent')
  // The route chip knows the 5-hour window; a send while it is used up would only repeat C's first attempt.
  const spent = /limit is used up/i.test(set.route?.title ?? '')
  if (spent) note('CODEX LIMIT STILL USED UP: nothing sent')
  if (!ok || !SEND || spent) stop = spent ? 'limit used up' : ok ? 'look only' : 'not as asked'
  if (stop === undefined) {
    const sentAt = Date.now()
    await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(PROMPT)})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
      document.querySelector('button[aria-label="Send"]')?.click()
    })()`)
    note(`sent at ${new Date(sentAt).toISOString()}`)
    const denied = []
    let shotRunning = false
    let endedAt
    for (let second = 0; second < 3600; second += 2) {
      await sleep(2000)
      const view = JSON.parse(String(await drive.evaluate(`JSON.stringify({
        running: Boolean(document.querySelector('button[aria-label^="Stop the running"]')),
        ask: [...document.querySelectorAll('.lc-thread button')].some((b) => /^(Deny|Decline)$/.test(b.innerText.trim())),
        asked: document.querySelector('.lc-decision, [class*=decision]')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) ?? ''
      })`)))
      if (view.ask) {
        denied.push({ at: Math.round((Date.now() - sentAt) / 1000), asked: view.asked })
        note(`asked: ${view.asked} -- DENIED`)
        await drive.evaluate(`[...document.querySelectorAll('.lc-thread button')].find((b) => /^(Deny|Decline)$/.test(b.innerText.trim()))?.click()`)
      }
      if (!shotRunning && second >= 60 && view.running) { await shot('c-running.png'); shotRunning = true; note(`c-running.png at ${String(second)}s`) }
      if (second > 10 && !view.running) { endedAt = Date.now(); break }
    }
    note(`ended after ${endedAt === undefined ? 'the bound' : String(Math.round((endedAt - sentAt) / 1000)) + ' s'}; denied: ${JSON.stringify(denied)}`)
    await sleep(3000)
    const end = JSON.parse(String(await drive.evaluate(`JSON.stringify({
      tail: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-700) ?? '',
      foot: [...document.querySelectorAll('.lc-turnfoot, .lc-activity__foot, [class*=turnfoot]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).slice(-2),
      header: document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) ?? ''
    })`)))
    note(`end: ${JSON.stringify(end)}`)
    if (/usage limit|hit your limit|rate limit|failed/i.test(end.tail)) note('LIMIT OR FAILURE SEEN: stop here and tell Colin; nothing is retried')
    if (!shotRunning) await shot('c-running.png')
    await shot('c-done.png')
    await writeFile(join(OUT, 'timing.json'), JSON.stringify({ sentAt: new Date(sentAt).toISOString(), endedAt: endedAt === undefined ? null : new Date(endedAt).toISOString(), seconds: endedAt === undefined ? null : Math.round((endedAt - sentAt) / 1000), denied }, null, 2))
    // The folder, byte for byte, before anything opens the game.
    const to = join(OUT, 'columns', 'c')
    await cp(workspace, to, { recursive: true, preserveTimestamps: true })
    const walk = async (dir, base = '') => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (entry) => entry.isDirectory()
      ? walk(join(dir, entry.name), `${base}${entry.name}/`)
      : [{ name: `${base}${entry.name}`, bytes: (await stat(join(dir, entry.name))).size, sha256: createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex') }]))).flat()
    const files = await walk(to)
    await writeFile(join(OUT, 'column-c.json'), JSON.stringify({ workspace, files }, null, 2))
    note(`copied out: ${JSON.stringify(files.map((file) => file.name + ' ' + String(file.bytes)))}`)
    // The run's own record, before finish() deletes the profile (A and B's were lost that way).
    await cp(join(drive.profile, 'mission-ledger'), join(OUT, 'mission-ledger'), { recursive: true }).catch((error) => note(`ledger not copied: ${String(error)}`))
    stop = 'done'
  }
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'notes.txt'), notes.join('\n') + '\n', 'utf8')
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Arena column C alone, ${SEND ? 'run' : 'set up only'}.`, extra: notes.join('\n') })
}
