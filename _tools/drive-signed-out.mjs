// What a new person sees when Claude Code and Codex are installed but not
// signed in (plan C1: the site handover's signed-out screens) -- and how
// Home's cover fits the window, for that person and for a team (0.401-0.402).
//
//   node _tools/drive-signed-out.mjs [--packaged <exe>] [--tag <name>]
//
// Sends nothing. CLAUDE_CONFIG_DIR and CODEX_HOME point at two EMPTY temp
// folders for these launches only: both CLIs keep their sign-in in those
// folders, so they read as signed out -- and nothing of the person's own
// ~/.claude or ~/.codex is read, copied or changed.
//
//   1. A fresh profile with no teammates (templates and the runtime list on
//      Home): at 1440x900 the cover must be whole, with air above it.
//   2. A team of three (the everyday Home): where the page fits, the cover
//      must not be drawn smaller than its width's size -- 0.401 shrank it at
//      1120x720 with 108px free above it.
// Settings' Runtimes page is not captured: it lists the skills and
// connectors of the person running the drive, read from their home folder.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('signed-out-2026-09-27'), `signed-out-${tag}`)
await mkdir(OUT, { recursive: true })
const env = {
  CLAUDE_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'locust-signed-out-claude-')),
  CODEX_HOME: await mkdtemp(join(tmpdir(), 'locust-signed-out-codex-'))
}
const SETTINGS = { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
const T0 = '2026-09-27T05:00:00.000Z'
const TEAM = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: FREE_ROUTE },
  { teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: T0, route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: T0, route: FREE_ROUTE }
]

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
// `widthK` is the cover at its width's size (coverScale): what it is drawn at
// when the page neither grows nor shrinks it.
const MEASURE = `(() => {
  const pane = document.querySelector('.lc-empty')
  const cover = document.querySelector('.lc-cover')
  const glass = document.querySelector('.lc-cover__glass')?.getBoundingClientRect()
  const claim = document.querySelector('.lc-cover__claim')?.getBoundingClientRect()
  const claimMargin = glass && claim ? Math.round(Math.min(claim.left - glass.left, glass.right - claim.right)) : -999
  return JSON.stringify({
    claimMargin,
    overflow: (pane?.scrollHeight ?? 0) - (pane?.clientHeight ?? 0),
    coverTop: Math.round((cover?.getBoundingClientRect().top ?? 0) - (pane?.getBoundingClientRect().top ?? 0)),
    k: Number(cover ? getComputedStyle(cover).getPropertyValue('--lc-cover-k') : 0),
    widthK: Math.round(((cover?.clientWidth ?? 0) / 960) * 1000) / 1000,
    scrollTop: Math.round(pane?.scrollTop ?? 0),
    faded: pane ? /gradient/.test(getComputedStyle(pane).maskImage || getComputedStyle(pane).webkitMaskImage || '') : false
  })
})()`

async function home(label, teammates, port, sizes, judge) {
  const drive = await startDrive({
    name: `signed-out-${label}-${tag}`, port, workspace: await scratchRepository('locust-signed-out-ws-'), outPath: join(OUT, label),
    sendsNothing: true, env, seed: { schemaVersion: 1, teammates, missionOwners: {}, settings: SETTINGS }, ...(packaged === undefined ? {} : { packaged })
  })
  try {
    await drive.ready()
    for (const [width, height] of sizes) {
      await drive.resize(width, height)
      await sleep(1800)
      const seen = JSON.parse(String(await drive.capture(`Home at ${String(width)}x${String(height)}, ${label}`, () => drive.evaluate(MEASURE))))
      judge(`${label} ${String(width)}x${String(height)}`, width, seen)
      // 0.403: a scrolled Home fades its top edge; one at rest does not.
      check(`${label} ${String(width)}x${String(height)}: the top fades exactly when Home is scrolled`, seen.faded === seen.scrollTop > 0, JSON.stringify(seen))
      check(`${label} ${String(width)}x${String(height)}: the claim sits inside the glass, 12px clear each side`, seen.claimMargin >= 12, JSON.stringify(seen))
    }
    return String(await drive.evaluate(`document.querySelector('.lc-empty')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  } catch (error) {
    failures += 1
    say(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  } finally {
    await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. ${label}; CLAUDE_CONFIG_DIR and CODEX_HOME are empty temp folders for this launch, so Claude Code and Codex read as signed out.` })
  }
}

const newPerson = await home('new-person', [], 9713, [[1920, 1080], [1440, 900], [1120, 720]], (what, width, seen) => {
  // 1120x720 is ~210px short with seven runtimes: past what the cover can
  // give back, so its lockup scrolls away above, as FirstLaunch intends.
  if (width === 1440) check(`${what}: the cover starts below the pane's top, with air above it`, seen.coverTop >= 24, JSON.stringify(seen))
})
check('Home names Claude Code and Codex CLI as not signed in, each with Sign in', /Codex CLI not signed in Sign in/.test(newPerson) && /Claude Code not signed in Sign in/.test(newPerson), newPerson.slice(0, 300))

await home('team', TEAM, 9717, [[1920, 1080], [1440, 900], [1120, 720]], (what, _width, seen) => {
  check(`${what}: a page that fits keeps its cover at least its width's size`, seen.overflow > 0 || seen.k >= seen.widthK, JSON.stringify(seen))
})

say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
