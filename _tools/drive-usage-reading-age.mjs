// A usage reading says how old it is, and a window reset since is not drawn
// as used (0.406). Colin, 2026-09-27: "my claude code usage hasnt seem to
// have updated since implementation".
//
//   node _tools/drive-usage-reading-age.mjs [--packaged <exe>] [--tag <name>]
//
// Spends nothing. A SEAM, said plainly: the profile's ledger is given one
// finished Claude run from last night, written through the ledger's own API,
// whose usage event is the reading Colin's app had (7-day 66%, 5-hour 20%
// resetting at 05:30Z). Locust reads usage only from its own runs, so this is
// exactly what his Home had to show. Then Home's Claude mark is read: the
// card, and the words a screen reader is given.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const { createFileMissionLedger } = await import('../packages/mission-store/dist/index.js')

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('usage-reading-age-2026-09-27'), `usage-reading-age-${tag}`)
await mkdir(OUT, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-usage-age-'))

// Last night, relative to now: the run ended 14h ago, its 5-hour window reset
// 10h ago, its 7-day window resets tomorrow.
const now = Date.now()
const iso = (offsetHours) => new Date(now + offsetHours * 3_600_000).toISOString()
const ranAt = iso(-14)
const missionId = 'mission_usage_age_0001'
const runId = 'run_usage_age_0001'
const ledger = createFileMissionLedger({ rootDirectory: join(profile, 'mission-ledger') })
await ledger.createMission({
  missionId, runId, prompt: 'Reply with the word ready.', runtime: 'claude', model: 'account-default',
  requestedRouteId: 'claude:account-default', resolvedRouteId: 'claude:account-default', cliVersion: null,
  workspaceId: 'ws_usage_age', sandbox: 'read-only', mode: 'ask', executionPolicyVersion: 1, createdAt: ranAt
})
const base = (sequence, type, payload) => ({ id: `evt_usage_age_${String(sequence)}`, runId, missionId, sequence, occurredAt: ranAt, sourceAdapter: 'claude', type, payload })
await ledger.appendEvents(missionId, [
  base(1, 'run.started', { runtimeThreadId: 'thread-usage-age', evidence: { redacted: true } }),
  base(2, 'adapter.diagnostic', { code: 'claude.usage_window', level: 'info', terminal: false, message: `7-day window 66% used · resets ${iso(24)} · 5-hour window 20% used · resets ${iso(-10)}`, evidence: { redacted: true } }),
  base(3, 'run.completed', { runtimeThreadId: 'thread-usage-age', process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: ranAt, finishedAt: ranAt } })
])
await ledger.flush?.()
const seeded = (await ledger.listMissions()).missions.length
say(`seeded ${String(seeded)} mission(s)`)

const drive = await startDrive({
  name: `usage-age-${tag}`, port: 9723, workspace: await scratchRepository('locust-usage-age-ws-'), outPath: OUT, profilePath: profile,
  sendsNothing: true, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: iso(-48), route: FREE_ROUTE }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  check('the ledger holds the seeded Claude run', seeded === 1, String(seeded))
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  const seen = JSON.parse(String(await drive.capture('Home: Claude’s card, pointed at', () => drive.evaluate(`(async () => {
    const mark = [...document.querySelectorAll('.lc-agentmark')].find((m) => /^Claude Code/.test(m.getAttribute('aria-label') ?? ''))
    if (!mark) return JSON.stringify({ found: false, marks: [...document.querySelectorAll('.lc-agentmark')].map((m) => m.getAttribute('aria-label')) })
    mark.focus()
    await new Promise((r) => setTimeout(r, 500))
    const card = mark.querySelector('.lc-agentcard')
    return JSON.stringify({ found: true, card: card?.innerText.replace(/\\s+/g, ' ') ?? '', label: mark.getAttribute('aria-label') ?? '' })
  })()`))))
  check('the Claude mark is on Home', seen.found === true, JSON.stringify(seen).slice(0, 200))
  check('its card shows the 7-day window, still true', /7-day window\s*66%/.test(seen.card), seen.card)
  check('and does not show the 5-hour window as 20% used -- it reset since', !/20%/.test(seen.card) && /5-hour window\s*reset since/.test(seen.card), seen.card)
  check('and says the reading is from Locust’s last run, not counting use outside', /From Locust.s last run on it, .+Use outside Locust since then isn.t counted\./.test(seen.card), seen.card)
  check('the screen reader is told the same', /66% of the 7-day window used/.test(seen.label) && /the 5-hour window has reset since/.test(seen.label) && !/20%/.test(seen.label), seen.label)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A profile whose last Claude run was 14 hours ago (seeded through the ledger's API), Home read.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
