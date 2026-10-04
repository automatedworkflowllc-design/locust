// A tidy pass on a folder that needs one: 62 memories (A1.2, at scale).
//
//   LOCUST_FREE_MODEL=opencode/nemotron-3-ultra-free node _tools/drive-memory-tidy-many.mjs [--packaged <exe>] [--tag <name>]
//
// drive-memory-tidy seeds six memories. Colin's own folder had 92 on
// 2026-09-24, many of them one status restated, which is what a tidy pass is
// FOR -- so this seeds a folder like that: 62 memories of a small project,
// six pairs saying the same thing, three facts superseded by a later one,
// one stale to-do, and 43 that are fine as they are.
//
// It asks Wren to tidy, reads every suggestion, scores them against what was
// planted (a merge of a planted pair, a retirement of a superseded fact, and
// anything that touches a fine memory, which should not happen), answers
// every one with its first button, and photographs the screen at each stage:
// the nudge past 60, the suggestions waiting, and the screen once all are
// answered -- when no banner should be left.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('memory-tidy-2026-09-26'), `memory-tidy-many-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-tidy-many-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-01T09:00:00.000Z'
const T1 = '2026-09-20T09:00:00.000Z'
const kept = (memoryId, text, createdAt = T0) => ({ memoryId, text, scope: 'workspace', workspaceId, workspaceName: 'tides', by: { name: 'you' }, createdAt, status: 'kept', enabled: true })

// Planted: what a good tidy pass finds.
const PAIRS = [
  ['mem_deploy_a', 'Deploys go out on Thursdays.', 'mem_deploy_b', 'We deploy every Thursday afternoon.'],
  ['mem_pnpm_a', 'Use pnpm, not npm.', 'mem_pnpm_b', 'The package manager for this repo is pnpm.'],
  ['mem_staging_a', 'Staging is at staging.tides.test.', 'mem_staging_b', 'The staging site lives at staging.tides.test.'],
  ['mem_tests_a', 'Run the tests with pnpm test.', 'mem_tests_b', 'The test suite runs with pnpm test.'],
  ['mem_pr_a', 'Keep pull request descriptions short.', 'mem_pr_b', 'Pull request descriptions should be brief.'],
  ['mem_csv_a', 'Tide predictions are read from data/predictions.csv.', 'mem_csv_b', 'The predictions CSV lives at data/predictions.csv.']
]
const SUPERSEDED = [
  ['mem_port_old', 'The API is on port 3000.', 'mem_port_new', 'The API moved from port 3000 to port 3001 on September 20.'],
  ['mem_node_old', 'Node 18 is the minimum supported version.', 'mem_node_new', 'Since the September 20 upgrade we require Node 20 or later.'],
  ['mem_branch_old', 'Releases are cut from the release/next branch.', 'mem_branch_new', 'As of September 20, releases are cut from main; release/next was retired.']
]
const STALE = ['mem_todo', 'TODO: ask Sam for the harbour data licence before Friday August 29.']
const FINE = [
  'The app prints the next high and low tide for a harbour.',
  'Times are shown in the harbour’s local time zone, never UTC.',
  'Heights are in metres with one decimal place.',
  'The CLI entry point is src/cli.ts.',
  'The web view is a single page in web/index.html.',
  'Harbour names are matched case-insensitively.',
  'Unknown harbours exit with code 2 and a one-line message.',
  'Lint with pnpm lint before every commit.',
  'Type-check with pnpm typecheck.',
  'The formatter is Prettier with the repo’s .prettierrc.',
  'Commit messages start with a verb in the imperative.',
  'Main is protected: every change goes through a pull request.',
  'Two approvals are needed for anything under src/tides/.',
  'The tide maths lives in src/tides/harmonics.ts.',
  'Harmonic constants come from data/constants.json.',
  'Never edit data/constants.json by hand; regenerate it with pnpm constants.',
  'The CSV has columns harbour, time, height, kind.',
  'kind is either high or low.',
  'Predictions are refreshed every Monday by a scheduled job.',
  'The scheduled job logs to logs/refresh.log.',
  'Errors from the refresh job are emailed to the on-call address.',
  'The on-call rota is in docs/oncall.md.',
  'Customer questions go to support@tides.test.',
  'The public docs site is built from docs/ with pnpm docs.',
  'Screenshots in the docs are 1280 by 800.',
  'The colour for high tide is navy; low tide is teal.',
  'Charts use the palette in web/palette.css.',
  'Dark mode follows the system setting.',
  'The app works offline once predictions are cached.',
  'Cached predictions expire after seven days.',
  'The cache lives in the user’s app-data folder.',
  'Feature flags are read from config/flags.json.',
  'The experimental surge chart is behind the flag surge_chart.',
  'Accessibility: every chart has a text table beside it.',
  'Keyboard users can move between days with the arrow keys.',
  'Translations live in locales/; English is the source.',
  'Welsh and Irish translations are maintained by volunteers.',
  'Version numbers follow semantic versioning.',
  'The changelog is written for users, not developers.',
  'Security reports go to security@tides.test, never a public issue.',
  'Dependencies are updated on the first Monday of each month.',
  'The licence is MIT.',
  'The project’s name is Tides, always capitalised.'
]
const memories = [
  ...PAIRS.flatMap(([ida, ta, idb, tb]) => [kept(ida, ta), kept(idb, tb)]),
  ...SUPERSEDED.flatMap(([ido, to, idn, tn]) => [kept(ido, to), kept(idn, tn, T1)]),
  kept(STALE[0], STALE[1]),
  ...FINE.map((text, index) => kept(`mem_fine_${String(index + 1).padStart(2, '0')}`, text))
]
const fineIds = new Set(FINE.map((_, index) => `mem_fine_${String(index + 1).padStart(2, '0')}`))

const drive = await startDrive({
  name: `memory-tidy-many-${tag}`,
  port: 9673,
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: { 'memories.json': { schemaVersion: 1, memories } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const memoryScreen = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true })); await new Promise(r => setTimeout(r, 700))`
const SCREEN = `(async () => {
  ${memoryScreen}
  const waiting = [...document.querySelectorAll('.lc-memory.is-proposed')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim())
  return JSON.stringify({
    meta: (document.querySelector('.lc-screen__meta')?.textContent ?? '').trim(),
    notice: (document.querySelector('.lc-memory__notice')?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
    nudge: [...document.querySelectorAll('.lc-memoryform__row .lc-settings__note')].map((note) => note.innerText.trim()).join(' / '),
    waiting,
    firstSection: (document.querySelector('.lc-screen__scroll .lc-settings__heading')?.textContent ?? '').trim()
  })
})()`
const screen = async () => JSON.parse(String(await drive.evaluate(SCREEN)))
// What the store keeps, read from the profile: `.locust/memory.md` is only
// rewritten when the next run starts, so it cannot say what an answer did.
const keptIds = async () =>
  JSON.parse(await readFile(join(drive.profile, 'memories.json'), 'utf8')).memories.filter((memory) => memory.status === 'kept').map((memory) => memory.memoryId)

try {
  await drive.ready()
  await drive.resize(1215, 800)
  const total = memories.length
  const before = JSON.parse(String(await drive.capture(`the Memory screen with ${String(total)} memories`, () => drive.evaluate(SCREEN))))
  check(`the screen says ${String(total)} are kept and nudges a tidy pass`, before.meta.startsWith(`${String(total)} remembered`) && before.nudge.startsWith(`${String(total)} memories here.`), JSON.stringify({ meta: before.meta, nudge: before.nudge }))

  const asked = await drive.evaluate(`(async () => {
    ${memoryScreen}
    const tidy = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Tidy up…')
    if (!tidy) return 'no Tidy up button'
    tidy.click()
    await new Promise(r => setTimeout(r, 500))
    const wren = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find(b => /Ask Wren/.test(b.innerText))
    if (!wren) return 'no Ask Wren'
    wren.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'running'
    }
    return 'did not start'
  })()`)
  check('Tidy up… then Ask Wren starts Wren', String(asked) === 'running', String(asked))
  const reply = await drive.capture('Wren’s reply, and the card under it', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 1200; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return (document.querySelector('.lc-memorycard .lc-activity')?.innerText ?? 'no memory card').replace(/\\s+/g, ' ')
  })()`))
  say(`card: ${String(reply)}`)

  const waiting = JSON.parse(String(await drive.capture('the suggestions, waiting', () => drive.evaluate(SCREEN))))
  say(`waiting (${String(waiting.waiting.length)}):\n    ${waiting.waiting.join('\n    ')}`)
  check('suggestions wait on the screen, first thing on it', waiting.waiting.length > 0 && waiting.firstSection === 'Waiting for you', JSON.stringify({ count: waiting.waiting.length, first: waiting.firstSection }))
  const keptBefore = await keptIds()
  check('nothing kept changed before an answer', keptBefore.length === total && memories.every((memory) => keptBefore.includes(memory.memoryId)), `${String(keptBefore.length)} of ${String(total)} kept`)

  // Every suggestion kept at once, with Keep all (0.372) -- what a person who
  // agrees with the pass presses. The store then says what the pass did.
  const kept = await drive.capture('Keep all', () => drive.evaluate(`(async () => {
    ${memoryScreen}
    const button = [...document.querySelectorAll('button')].find((b) => /^Keep all [0-9]+$/.test(b.innerText.trim()))
    if (button === undefined) return 'no Keep all button'
    const label = button.innerText.trim()
    button.click()
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('.lc-memory.is-proposed') === null) break
    }
    return label + ' || still waiting: ' + String(document.querySelectorAll('.lc-memory.is-proposed').length)
  })()`))
  check('Keep all is offered for every suggestion, and answers them all', new RegExp(`^Keep all ${String(waiting.waiting.length)} [|][|] still waiting: 0$`).test(String(kept)), String(kept))
  const answered = waiting.waiting.length
  const after = JSON.parse(String(await drive.capture('every suggestion answered', () => drive.evaluate(SCREEN))))
  const left = await keptIds()
  const gone = memories.map((memory) => memory.memoryId).filter((id) => !left.includes(id))
  say(`answered ${String(answered)}; gone from the file: ${gone.join(', ')}`)
  const pairsMerged = PAIRS.filter(([ida, , idb]) => gone.includes(ida) !== gone.includes(idb) || (gone.includes(ida) && gone.includes(idb))).length
  const supersededRetired = SUPERSEDED.filter(([ido, , idn]) => gone.includes(ido) && !gone.includes(idn)).length
  const fineTouched = gone.filter((id) => fineIds.has(id))
  say(`planted pairs tidied: ${String(pairsMerged)} of ${String(PAIRS.length)}; superseded retired: ${String(supersededRetired)} of ${String(SUPERSEDED.length)}; stale to-do retired: ${String(gone.includes(STALE[0]))}; fine memories touched: ${fineTouched.join(', ') || 'none'}`)
  check('no memory that was fine was merged away or retired', fineTouched.length === 0, fineTouched.join(', '))
  check('no banner is left once every suggestion is answered', after.waiting.length === 0 && after.notice === '', JSON.stringify({ waiting: after.waiting.length, notice: after.notice }))
  say(failures === 0 ? '\nMEMORY TIDY MANY PASSED' : `\nMEMORY TIDY MANY: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on ${FREE_ROUTE.model}; memory Keep and tell me; 62 memories kept -- 6 duplicate pairs, 3 superseded facts, 1 stale to-do, 43 fine.` })
}
