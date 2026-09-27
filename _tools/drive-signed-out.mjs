// What a new person sees when Claude Code and Codex are installed but not
// signed in (plan C1: the site handover's signed-out screens).
//
//   node _tools/drive-signed-out.mjs [--packaged <exe>] [--tag <name>]
//
// Sends nothing. CLAUDE_CONFIG_DIR and CODEX_HOME point at two EMPTY temp
// folders for this launch only: both CLIs keep their sign-in in those
// folders, so they read as signed out -- and nothing of the person's own
// ~/.claude or ~/.codex is read, copied or changed. A fresh profile with no
// teammates: Home, and where its cover sits.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('signed-out-2026-09-27'), `signed-out-${tag}`)
await mkdir(OUT, { recursive: true })
const claudeHome = await mkdtemp(join(tmpdir(), 'locust-signed-out-claude-'))
const codexHome = await mkdtemp(join(tmpdir(), 'locust-signed-out-codex-'))

const drive = await startDrive({
  name: `signed-out-${tag}`,
  port: 9713,
  workspace: await scratchRepository('locust-signed-out-ws-'),
  outPath: OUT,
  sendsNothing: true,
  env: { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome },
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } },
  ...(packaged === undefined ? {} : { packaged })
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.ready()
  const MEASURE = `(() => {
    const pane = document.querySelector('.lc-empty')
    const cover = document.querySelector('.lc-cover')
    const glass = document.querySelector('.lc-cover__glass')?.getBoundingClientRect()
    const claim = document.querySelector('.lc-cover__claim')?.getBoundingClientRect()
    const claimMargin = glass && claim ? Math.round(Math.min(claim.left - glass.left, glass.right - claim.right)) : -999
    return JSON.stringify({ claimMargin, scrollTop: pane?.scrollTop, overflow: (pane?.scrollHeight ?? 0) - (pane?.clientHeight ?? 0), coverTop: Math.round((cover?.getBoundingClientRect().top ?? 0) - (pane?.getBoundingClientRect().top ?? 0)), coverHeight: Math.round(cover?.getBoundingClientRect().height ?? 0), k: cover ? getComputedStyle(cover).getPropertyValue('--lc-cover-k') : '' })
  })()`
  // Settings' Runtimes page is not captured: it lists the skills and
  // connectors of the person running the drive, read from their home folder.
  for (const [width, height] of [[1440, 900], [1120, 720]]) {
    await drive.resize(width, height)
    await sleep(1800)
    const seen = JSON.parse(String(await drive.capture(`Home at ${String(width)}x${String(height)}, Claude and Codex signed out`, () => drive.evaluate(MEASURE))))
    say(`  ${String(width)}x${String(height)}: ${JSON.stringify(seen)}`)
    // 1120x720 is 246px short with seven runtimes: past what the cover can
    // give back, so its lockup scrolls away above, as FirstLaunch intends.
    if (width === 1440) check(`${String(width)}x${String(height)}: the cover starts below the pane's top, with air above it`, seen.coverTop >= 24, JSON.stringify(seen))
    check(`${String(width)}x${String(height)}: the claim sits inside the glass, 12px clear each side`, seen.claimMargin >= 12, JSON.stringify(seen))
  }
  const signedOut = String(await drive.evaluate(`document.querySelector('.lc-empty')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  check('Home names Claude Code and Codex CLI as not signed in, each with Sign in', /Codex CLI not signed in Sign in/.test(signedOut) && /Claude Code not signed in Sign in/.test(signedOut), signedOut.slice(0, 300))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A fresh profile, no teammates; CLAUDE_CONFIG_DIR and CODEX_HOME are empty temp folders for this launch, so Claude Code and Codex read as signed out.` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
