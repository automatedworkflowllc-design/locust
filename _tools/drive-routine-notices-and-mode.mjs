// A routine's progress is information, not a warning; a conversation it just
// started shows its teammate's mode (0.437).
//
//   node _tools/drive-routine-notices-and-mode.mjs [--packaged <exe>] [--tag <name>]
//
// Free model (LOCUST_FREE_MODEL, Nemotron by default): spends nothing.
//
// Seen in the 0.435 hand-off drive's pictures: "finished, approved by Sable"
// drawn in amber, and Sable (saved as Ask) opening on "Edit". A two-step
// chain, Wren then Bea as checker, both Ask, run from the Routines screen
// without ever picking a teammate. Bea's conversation is then opened from the
// sidebar: its composer must read Ask, and its routine notices must be muted
// unless the routine stopped.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const FREE = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('routine-notices-and-mode-2026-09-28'), `routine-notices-and-mode-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-notices-ws-')
await writeFile(join(workspace, 'notes.md'), '# Notes\n\nThe release is on Friday.\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'notes'], workspace)

const drive = await startDrive({
  name: `routine-notices-${tag}`, port: 9774, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: FREE, mode: 'ask' } },
      { teammateId: 'tm_bea', name: 'Bea', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-28T01:00:01.000Z', route: { runtime: 'opencode', model: FREE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: {
    'routines.json': {
      schemaVersion: 1,
      routines: [{
        routineId: 'rt_notices', name: 'Release note check', teammateId: 'tm_wren',
        route: { runtime: 'opencode', model: FREE, mode: 'ask' },
        steps: ['Read notes.md and say in one sentence when the release is.', 'Check that answer against notes.md.'],
        handOffs: [{}, { teammateId: 'tm_bea', check: true }],
        learnedFrom: [], createdAt: '2026-09-28T01:00:00.000Z', runs: 0
      }]
    }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const row = document.querySelector('.lc-routinerow:not(.lc-routineadd)')
    ;[...(row?.querySelectorAll('button') ?? [])].find((b) => /run/i.test(b.innerText || b.getAttribute('aria-label') || ''))?.click()
  })()`)
  let quiet = 0
  for (let waited = 0; waited < 600_000 && quiet < 3; waited += 5000) {
    await sleep(5000)
    const running = await drive.evaluate(`document.querySelectorAll('.lc-spark').length + (document.querySelector('button[aria-label^="Stop the running"]') ? 1 : 0)`)
    quiet = Number(running) === 0 ? quiet + 1 : 0
  }
  const seen = JSON.parse(String(await drive.capture("Bea's conversation, opened from the sidebar", () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-convrow .lc-conv')].find((r) => /Check that answer/.test(r.innerText))
    row?.click()
    await new Promise((r) => setTimeout(r, 1500))
    const mode = [...document.querySelectorAll('.lc-control')].map((b) => b.innerText.trim()).find((t) => /^(Ask|Edit|Plan|Approve|Auto)/.test(t)) ?? '(none)'
    const notices = [...document.querySelectorAll('.lc-diagnostic')].filter((el) => /Routine "/.test(el.innerText)).map((el) => ({ text: el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90), tone: [...el.classList].find((c) => c.startsWith('lc-tone-')) ?? '' }))
    return JSON.stringify({ found: !!row, mode, notices })
  })()`))))
  say(`  seen: ${JSON.stringify(seen)}`)
  check("Bea's fresh conversation shows her mode, Ask", seen.found && /^Ask/.test(seen.mode), seen.mode)
  const good = seen.notices.filter((notice) => /step \\d of|finished/.test(notice.text))
  const bad = seen.notices.filter((notice) => /stopped|waiting/.test(notice.text))
  check('progress and "finished" notices are muted, not amber', good.length > 0 && good.every((notice) => notice.tone === 'lc-tone-muted'), JSON.stringify(good))
  check('a stop, if there was one, is still amber', bad.every((notice) => notice.tone === 'lc-tone-amber'), JSON.stringify(bad))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren then Bea (checker), both OpenCode / ${FREE}, Ask; run from Routines, no teammate picked.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
