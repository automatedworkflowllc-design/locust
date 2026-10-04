// Does Home call its agent strip "Connected accounts", and keep the Compare starters to one line (0.607)?
//
//   node _tools/drive-home-says-connected-accounts.mjs [--packaged <exe>] [--tag <name>]
//
// A realistic profile, seeded straight into the ledger (four teammates, a few
// conversations), Home read at 1440 x 900 and at Colin's 1209 x 770. Nothing
// is spent; no runtime starts. The strip under the team must be labelled
// "Connected accounts" with its "N ready" note and marks; the "Try two models
// on" starters must be one row of three chips (0.609; 0.607's line of links
// read as a footnote); pressing the first fills the box with the landing-page
// ask and turns Compare on. The control (the 0.606 package) reads "AI agents".

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `home-says-connected-accounts-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-connected-accounts-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const at = '2026-09-10T09:00:00.000Z'
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', role: 'Data & Reporting', createdAt: at, route: FREE_ROUTE }
]
const WORK = [
  ['tm_wren', 'Move the release notes under the installer', '2026-10-04T14:20:00.000Z'],
  ['tm_juno', 'Read every empty state for a missing verb', '2026-10-04T11:45:00.000Z'],
  ['tm_atlas', 'Summarise the three placement rulings', '2026-10-03T20:05:00.000Z'],
  ['tm_sable', 'Chart the release cadence since 0.500', '2026-10-02T22:00:00.000Z']
]
const SCHEMA = 15
const line = (value) => JSON.stringify(value) + '\n'
const ledgerFile = (missionId, prompt, createdAt) => {
  const runId = `run_${missionId.slice(2)}`
  const metadata = { missionId, runId, prompt, runtime: 'opencode', model: FREE_ROUTE.model, requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: '1.18.27', workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt }
  const header = { schemaVersion: SCHEMA, recordType: 'mission.created', ledgerSequence: 1, occurredAt: createdAt, metadata }
  const events = [
    { type: 'run.started', payload: {} },
    { type: 'message.delta', payload: { itemId: 'answer_1', operation: 'append', text: 'Done.', final: true } },
    { type: 'run.completed', payload: { status: 'completed' } }
  ].map((event, index) => ({ schemaVersion: SCHEMA, recordType: 'mission.event', ledgerSequence: index + 2, occurredAt: createdAt, event: { id: `event_${missionId}_${String(index)}`, runId, missionId, sequence: index + 1, occurredAt: createdAt, sourceAdapter: 'opencode', ...event } }))
  return line(header) + events.map(line).join('')
}
const files = {}
const missionOwners = {}
WORK.forEach(([owner, prompt, createdAt], index) => {
  const missionId = `m_acct${String(index).padStart(2, '0')}`
  files[`mission-ledger/${missionId}.jsonl`] = ledgerFile(missionId, prompt, createdAt)
  missionOwners[missionId] = owner
})

const drive = await startDrive({
  name: `home-says-connected-accounts-${tag}`, port: 9803, workspace, files, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** The strip and the starters as drawn. */
const read = async () => JSON.parse(String(await drive.evaluate(`(() => {
  const head = document.querySelector('.lc-agenthead')
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } }
  const starters = document.querySelector('.lc-buildhead')
  return JSON.stringify({
    label: head?.querySelector('.lc-agenthead__label')?.innerText.trim() ?? null,
    note: head?.querySelector('.lc-agenthead__note')?.innerText.trim() ?? null,
    marks: head ? head.querySelectorAll('.lc-agenthead__marks > *').length : 0,
    compare: [...(head?.querySelectorAll('button') ?? [])].map((b) => b.innerText.trim()),
    // The cards of 0.460 are not drawn any more, so they are not selected here either (harness-selectors.test.ts);
    // the control's record on the 0.606 package is the before.
    line: starters ? starters.innerText.replace(/\\s+/g, ' ').trim() : null,
    lineBox: box(starters),
    links: starters ? [...starters.querySelectorAll('.lc-buildchip')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()) : [],
    // 0.610, Colin's mockup: Compare once, at the starters' end; the accounts a quiet unboxed line; one left edge.
    compareInRow: starters?.querySelector('.lc-buildhead__compare')?.innerText.trim() ?? null,
    boxed: head ? (() => { const s = getComputedStyle(head); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.borderLeftWidth !== '0px' })() : null,
    edges: [document.querySelector('.lc-hometeam__head'), head?.querySelector('.lc-agenthead__label'), starters?.querySelector('.lc-agenthead__label')].map((el) => el ? Math.round(el.getBoundingClientRect().left) : null),
    intro: document.querySelector('.lc-intro') !== null,
    teamHead: document.querySelector('.lc-hometeam__head')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    composer: document.querySelector('form.command-dock textarea')?.value ?? ''
  })
})()`)))
try {
  await drive.ready()
  // Until the agents are found the strip says "checking N on this machine" and the starters are not
  // drawn yet. A fixed 2.5 s was enough on the dev build and not on the 0.610 package (the check of
  // seven tools still running at 4 s): wait for "N ready", as the team-cards drive does.
  for (let i = 0; i < 120; i += 1) {
    if (/^\d+ ready$/.test(String(await drive.evaluate(`document.querySelector('.lc-agenthead__note')?.innerText.trim() ?? ''`)))) break
    await sleep(500)
  }
  for (const [w, h] of [[1440, 900], [1209, 770]]) {
    await drive.resize(w, h)
    await sleep(w === 1440 ? 2500 : 1500)
    const seen = await read()
    await drive.capture(`Home at ${String(w)} x ${String(h)}`, async () => JSON.stringify(seen))
    say(`  at ${String(w)}x${String(h)}: ${JSON.stringify(seen)}`)
    // The label is drawn in capitals by its style; the words are what is checked.
    check(`at ${String(w)} the strip is labelled Connected accounts, with its note and marks`, /^connected accounts$/i.test(seen.label ?? '') && /^\d+ ready$/.test(seen.note ?? '') && seen.marks > 0, JSON.stringify([seen.label, seen.note, seen.marks]))
    check(`at ${String(w)} Compare models is offered once, at the end of the starters' row`, seen.compareInRow === 'Compare models' && !seen.compare.includes('Compare models'), JSON.stringify([seen.compareInRow, seen.compare]))
    check(`at ${String(w)} the accounts are a quiet line, not a boxed card`, seen.boxed === false, String(seen.boxed))
    check(`at ${String(w)} every label starts at one left edge`, seen.edges.every((x) => x !== null && Math.abs(x - seen.edges[0]) <= 1), JSON.stringify(seen.edges))
    check(`at ${String(w)} the first-run sentence is not on a team's Home`, seen.intro === false, String(seen.intro))
    check(`at ${String(w)} the team's heading counts the team`, /^your team\s*4$/i.test(seen.teamHead ?? ''), JSON.stringify(seen.teamHead))
    check(`at ${String(w)} the starters are one row of three chips`, seen.links.length === 3 && seen.lineBox !== null && seen.lineBox.h < 44, JSON.stringify([seen.links, seen.lineBox]))
    check(`at ${String(w)} the chips name what each makes`, JSON.stringify(seen.links) === JSON.stringify(['Landing page', 'Sales dashboard', 'Arcade game']), JSON.stringify(seen.links))
  }
  // Pressing the first link fills the box with the landing-page ask, Compare on.
  await drive.evaluate(`document.querySelector('.lc-buildchip')?.click()`)
  await sleep(1200)
  const after = await read()
  await drive.capture('after pressing the Landing page chip', async () => JSON.stringify({ composer: after.composer.slice(0, 120) }))
  check('pressing the Landing page chip fills the box with that ask', /coffee shop/.test(after.composer), after.composer.slice(0, 120))
  // Direct, Compare or Blind lives in the chat mode chip (0.451), as drive-build-and-compare reads it.
  const mode = String(await drive.evaluate(`document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label')?.replace('Chat mode: ', '') ?? ''`))
  check('and turns Compare on, as the card did', /compare/i.test(mode), `chat mode: ${mode}`)
  say(failures === 0 ? '\nHOME SAYS CONNECTED ACCOUNTS PASSED' : `\nHOME SAYS CONNECTED ACCOUNTS: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever the last build wrote to out/'}. Four teammates and four conversations seeded; Home read at 1440 x 900 and 1209 x 770; the first starter pressed.`, extra: `Checks failed: ${String(failures)}` })
  process.exitCode = failures === 0 ? 0 : 1
}
