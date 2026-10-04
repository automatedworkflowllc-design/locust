// Fresh-eyes area 8: the sidebar and its search, with a list a person has.
//
//   node _tools/drive-sidebar-and-search.mjs [--packaged <exe>] [--tag <name>]
//
// The everyday profile (everyday-ledger.mjs): sixteen conversations, one of
// them three turns long whose SECOND turn says "signup". Then the list is read and
// searched the way a person would: a word in a title, a word only in a later
// turn, a teammate's name, nothing, and Escape. Sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('sidebar-and-search-2026-09-27'), `sidebar-and-search-${tag}`)
await mkdir(OUT, { recursive: true })

const everyday = await seedEverydayLedger('sidebar-search')
say(`seeded ${String(everyday.missions)} missions, ${String(everyday.conversations)} conversations`)

const drive = await startDrive({
  name: `sidebar-search-${tag}`, port: 9741, workspace: everyday.workspace, profilePath: everyday.profilePath, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: everyday.seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const rows = `[...document.querySelectorAll('.lc-convrow')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`
const search = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('input[aria-label="Search conversations"]')
  field.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 500))
  return JSON.stringify({ rows: ${rows}, empty: document.querySelector('.lc-sidebar__empty')?.innerText ?? '' })
})()`)
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  const all = JSON.parse(String(await drive.capture('the list, 1440', () => drive.evaluate(`JSON.stringify(${rows})`))))
  say(`  rows: ${JSON.stringify(all)}`)
  check('one row per conversation: 16, the three-turn one once', all.length === 16, String(all.length))
  check('newest first: the login conversation leads', /login redirect/i.test(all[0] ?? ''), all[0])

  const invoice = JSON.parse(String(await drive.capture('search: invoice', () => search('invoice'))))
  say(`  invoice: ${JSON.stringify(invoice)}`)
  check('"invoice" finds the two invoice conversations', invoice.rows.length === 2, JSON.stringify(invoice.rows))

  const signup = JSON.parse(String(await drive.capture('search: signup (only in the second turn)', () => search('signup'))))
  say(`  signup: ${JSON.stringify(signup)}`)
  check('"signup" finds the login conversation, once, under its own name', signup.rows.length === 1 && /login redirect/i.test(signup.rows[0] ?? ''), JSON.stringify(signup.rows))

  const login = JSON.parse(String(await search('login')))
  check('"login" finds that conversation once', login.rows.length === 1, JSON.stringify(login.rows))
  const opened = String(await drive.capture('open it from the search', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-convrow .lc-conv')?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
  })()`)))
  check('opened from the search, the whole conversation shows: all three turns', /redirect loop/.test(opened) && /signup form does/.test(opened) && /ship it/i.test(opened), opened.slice(0, 240))

  const atlas = JSON.parse(String(await drive.capture('search: a teammate’s name', () => search('Atlas'))))
  say(`  Atlas: ${JSON.stringify(atlas)}`)
  check('a teammate’s name finds their conversations (4)', atlas.rows.length === 4, JSON.stringify(atlas.rows))

  const reply = JSON.parse(String(await search('HubSpot')))
  say(`  HubSpot (a word only in a reply): ${JSON.stringify(reply)}`)

  const nothing = JSON.parse(String(await drive.capture('search: nothing matches', () => search('zebra'))))
  check('no match says so', nothing.rows.length === 0 && /No conversations match/i.test(nothing.empty), JSON.stringify(nothing))

  const escaped = JSON.parse(String(await drive.evaluate(`(async () => {
    const field = document.querySelector('input[aria-label="Search conversations"]')
    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 500))
    return JSON.stringify({ value: field.value, rows: ${rows}.length })
  })()`)))
  check('Escape in the search clears it and brings the list back', escaped.value === '' && escaped.rows === 16, JSON.stringify(escaped))

  await search('')
  await drive.resize(1120, 760)
  await sleep(1500)
  const narrow = JSON.parse(String(await drive.capture('the sidebar at 1120', () => drive.evaluate(`JSON.stringify({ searchShown: (document.querySelector('input[aria-label="Search conversations"]')?.getBoundingClientRect().width ?? 0) > 0 })`))))
  // Under 1200 the rail replaces the sidebar and its search box is hidden,
  // so Ctrl K is the search there.
  const palette = (typed) => drive.evaluate(`(async () => {
    if (!document.querySelector('.lc-palette')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
    }
    const field = document.querySelector('input[aria-label="Command palette search"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(typed)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('.lc-palette__group, .lc-palette__item')].map((el) => (el.classList.contains('lc-palette__group') ? '# ' : '') + el.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify(items)
  })()`)
  const opened0 = JSON.parse(String(await drive.capture('Ctrl K at 1120, nothing typed', () => palette(''))))
  say(`  palette, empty: ${JSON.stringify(opened0)}`)
  // Group headings are drawn in capitals, and innerText reads them as drawn.
  const heading = opened0.findIndex((item) => /^# conversations$/i.test(item))
  const conversationsListed = heading === -1 ? [] : opened0.slice(heading + 1).filter((item) => !item.startsWith('# '))
  check('Ctrl K lists the five newest conversations before anything is typed', conversationsListed.length === 5, JSON.stringify(conversationsListed))
  const typed = JSON.parse(String(await drive.capture('Ctrl K at 1120: signup', () => palette('signup'))))
  say(`  palette, signup: ${JSON.stringify(typed)}`)
  check('Ctrl K finds the conversation by a word from its second turn, with its teammate and age', typed.some((item) => /^Fix the login redirect loop/.test(item) && /Wren · \d+m$/.test(item)), JSON.stringify(typed))
  const wren = JSON.parse(String(await palette('Marlow')))
  check('Ctrl K finds a teammate’s conversations by name (3 of Marlow’s)', wren.filter((item) => /Marlow · /.test(item)).length === 3, JSON.stringify(wren))
  await palette('rebase')
  const fromPalette = String(await drive.capture('Ctrl K: Enter opens it', () => drive.evaluate(`(async () => {
    document.querySelector('input[aria-label="Command palette search"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((r) => setTimeout(r, 1500))
    return JSON.stringify({ palette: !!document.querySelector('.lc-palette'), thread: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? '' })
  })()`)))
  check('Enter opens it and closes the palette', /"palette":false/.test(fromPalette) && /replays your commits/.test(fromPalette), fromPalette)
  check('(the rail hides the search box, which is why)', narrow.searchShown === false, JSON.stringify(narrow))
  await drive.resize(1920, 1080)
  await sleep(1500)
  await drive.capture('the list, 1920', () => drive.evaluate(`JSON.stringify(${rows}.length)`))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. 16 conversations over six weeks (18 turns), four teammates, seeded through the mission store and Codex's normalizer.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
