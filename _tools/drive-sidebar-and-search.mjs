// Fresh-eyes area 8: the sidebar and its search, with a list a person has.
//
//   node _tools/drive-sidebar-and-search.mjs [--packaged <exe>] [--tag <name>]
//
// Sixteen conversations over six weeks, four teammates and two with nobody
// on them; one conversation is three turns long, and only its SECOND turn
// says "signup". Written with the mission store's own writer and Codex's own
// normalizer, as drive-old-conversation does. Then the list is read and
// searched the way a person would: a word in a title, a word only in a later
// turn, a teammate's name, nothing, and Escape. Sends nothing.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('sidebar-and-search-2026-09-27'), `sidebar-and-search-${tag}`)
await mkdir(OUT, { recursive: true })

const root = new URL('..', import.meta.url).pathname.slice(1)
const adapters = await import(pathToFileURL(join(root, 'packages', 'runtime-adapters', 'dist', 'index.js')).href)
const store = await import(pathToFileURL(join(root, 'packages', 'mission-store', 'dist', 'index.js')).href)
const workspace = await scratchRepository('locust-drive-sidebar-search-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-sidebar-search-profile-'))
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const ledger = store.createFileMissionLedger({ rootDirectory: join(profilePath, 'mission-ledger') })

const hex24 = (n) => (String(n) + 'a'.repeat(24)).slice(0, 24)
const TEAM = [
  { name: 'Wren', hue: 'lime', role: 'Code & Migrations' },
  { name: 'Atlas', hue: 'blue', role: 'Research & Briefs' },
  { name: 'Marlow', hue: 'violet', role: 'Ops & Scheduling' },
  { name: 'Quill', hue: 'clay', role: 'Docs & QA' }
].map((t, i) => ({ teammateId: `tm_${hex24(i + 1)}`, ...t, createdAt: '2026-08-10T09:00:00.000Z' }))
const who = Object.fromEntries(TEAM.map((t) => [t.name, t.teammateId]))

// [owner, hours ago, turns (prompt, reply)...]
const CONVERSATIONS = [
  ['Wren', 0.1, ['Fix the login redirect loop on the account page', 'The loop came from the session check running before the cookie was set. Moved it after.'], ['Also check the signup form does the same thing', 'It did. Same fix applied to the signup form.'], ['Good, ship it', 'Committed as "Stop the login and signup redirect loops".']],
  ['Atlas', 1, ['Summarize the three vendor quotes for the new CRM and recommend one', 'HubSpot Starter is cheapest for five seats; I recommend it.']],
  ['Marlow', 2, ["Draft next week's shift schedule around Maria's time off", 'Drafted. Tuesday and Wednesday are covered by moving the afternoon shift.']],
  ['Wren', 3, ['Why is the build 40 seconds slower since Tuesday?', 'Source maps were turned on for production builds in Tuesday’s change.']],
  ['Quill', 5, ['Proofread the README and fix anything unclear', 'Fixed six sentences; the install section now lists Node first.']],
  ['Atlas', 20, ['What changed in the Q3 sales tax rules for Florida?', 'Nothing for your categories; the change was to commercial rent.']],
  ['Wren', 26, ['Rename the billing module to payments across the repo', 'Renamed in 41 files. Tests pass.']],
  ['Marlow', 30, ['Reconcile the September invoices against the bank export', 'Two invoices have no matching deposit: #1043 and #1051.']],
  ['Wren', 50, ['Write tests for the invoice PDF export', 'Added eight tests; one found a rounding bug in the totals.']],
  ['Quill', 72, ['Turn the release notes into a customer email', 'Drafted a 120-word email with the three changes customers will notice.']],
  ['Atlas', 96, ['Compare Notion, Coda and Airtable for a 5-person team', 'Notion for docs, Airtable for anything that is really a table.']],
  ['Atlas', 144, ['Read every customer interview note in the interviews folder, pull out each complaint about onboarding, group them by theme, and tell me which three themes come up most often with a quote for each', 'Top three: too many setup steps, unclear pricing, and no sample data.']],
  ['Marlow', 216, ['Set up the Monday morning numbers summary', 'Saved as a routine that runs Mondays at 8.']],
  [undefined, 288, ['Quick question about git rebase', 'Rebase replays your commits on top of the other branch.']],
  ['Quill', 360, ['Make the pricing page copy shorter', 'Cut it from 310 words to 140.']],
  [undefined, 960, ['What does this folder do?', 'It is a small web shop with a Node backend.']]
]

const now = Date.now()
const missionOwners = {}
let made = 0
for (const [c, [owner, hoursAgo, ...turns]] of CONVERSATIONS.entries()) {
  let previous
  for (const [t, [prompt, reply]] of turns.entries()) {
    const missionId = `mission_5e000000-0000-4000-8000-${String(c).padStart(4, '0')}${String(t).padStart(8, '0')}`
    const runId = `run_5e${String(c).padStart(4, '0')}${String(t)}`
    // Turns of one conversation are two minutes apart, the newest last.
    const at = new Date(now - hoursAgo * 3_600_000 - (turns.length - 1 - t) * 120_000).toISOString()
    await ledger.createMission({
      missionId, runId, prompt,
      runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null,
      workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at,
      ...(previous === undefined ? {} : { continuesFrom: { missionId: previous, checkpointEpoch: 1, reason: 'follow-up' } })
    })
    const normalizer = adapters.createCodexEventNormalizer({ runId, missionId, requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: '0.156.1', now: () => new Date(at) })
    await ledger.appendEvents(missionId, [
      ...normalizer.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: `thread_${missionId}` }) }),
      ...normalizer.accept({ sequence: 2, raw: JSON.stringify({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: reply } }) }),
      ...normalizer.accept({ sequence: 3, raw: JSON.stringify({ type: 'turn.completed' }) }),
      ...normalizer.finish({ exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: at, finishedAt: at })
    ])
    if (owner !== undefined) missionOwners[missionId] = who[owner]
    previous = missionId
    made += 1
  }
}
say(`seeded ${String(made)} missions, ${String(CONVERSATIONS.length)} conversations`)

const drive = await startDrive({
  name: `sidebar-search-${tag}`, port: 9741, workspace, profilePath, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: TEAM, missionOwners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
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
  check('Ctrl K finds the conversation by a word from its second turn, with its teammate and age', typed.some((item) => /^Fix the login redirect loop/.test(item) && /Wren · 6m/.test(item)), JSON.stringify(typed))
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
