// A routine on an Approve-each teammate: does the card actually reach anyone?
//
//   LOCUST_SPEND=1 node _tools/probe-routine-asks.mjs
//
// This is the control on a REFUSAL I REMOVED. Until 0.67.0 the routine runner
// refused the mode outright -- "a routine cannot replay per-action approvals"
// -- because the cards lived on a transport only the composer's own start
// reached. Every Codex mode runs on one loop now with the approval channel
// attached, so the refusal went. That is only an improvement if the card
// really reaches a person: a routine that stops forever, waiting on a card
// nobody is shown, is worse than a routine that refuses to start.
//
// A routine is unattended by design and is the hardest of the three paths
// that used to refuse (routine, room post, relay), so it is the one driven.
//
// MEASURED on the first run of this probe: the card does NOT appear where the
// person is standing. `shownApprovals` filters to the run on screen, and a
// routine's run is nobody's shown run -- so the home screen showed nothing
// while the sidebar said "waiting on you - routine - step 1 of 1". That is
// the app's existing design for any background run rather than a hang: the
// amber line is the affordance, and the OS notification names the teammate.
// So what is driven here is the whole path a person walks -- the sidebar says
// it, the click reaches it, the card is there, approving finishes the step.
//
// SPENDS one Codex turn on gpt-5.6-luna at low effort. Never Astra.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Codex turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-routineasks-ws-')
const now = new Date().toISOString()
const route = { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'approve-each', effort: 'low' }

const drive = await startDrive({
  name: 'routine-asks',
  port: 9487,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: {
    'routines.json': {
      schemaVersion: 1,
      routines: [
        {
          routineId: 'rt_asks',
          name: 'Write the gantry file',
          teammateId: 'tm_wren',
          route,
          steps: ['Create a file called ROUTINE.txt in this folder containing exactly the word gantry. Then reply with just: done'],
          learnedFrom: [],
          createdAt: now,
          runs: 0
        }
      ]
    }
  }
})

// No backticks anywhere inside these template literals: a backtick ends one.
const pressRun = `(async () => {
  const team = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Team')
  if (team === undefined) return 'no Team tab'
  team.click()
  await new Promise(r => setTimeout(r, 900))
  const run = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Run' || b.getAttribute('aria-label') === 'Run')
  if (run === undefined) return 'no Run control on the routine row'
  run.click()
  return 'pressed'
})()`

// Step one: the sidebar has to SAY a person is needed, from wherever they are
// standing. Without that the run is a silent hang.
const waitForTheAsk = `(async () => {
  const waitingText = () => [...document.querySelectorAll('.lc-row__metastate')]
    .map(n => n.innerText.trim())
    .find(t => /waiting on you/i.test(t))
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const card = document.querySelector('[aria-label="Approval required"]')
    const waiting = waitingText()
    if (card !== null || waiting !== undefined) {
      return JSON.stringify({
        sidebarSays: waiting === undefined ? 'nothing' : waiting,
        cardWhereIAmStanding: card !== null,
        routineLine: [...document.querySelectorAll('.lc-row__route')].map(n => n.innerText.trim()).find(t => /routine/i.test(t)) ?? 'none'
      }, null, 1)
    }
  }
  return JSON.stringify({ sidebarSays: 'nothing in 120s', cardWhereIAmStanding: false, routineLine: 'none' }, null, 1)
})()`

// Step two: the click a person makes after reading that line.
const openTheTeammate = `(async () => {
  const card = ${teammateFace('Wren')}
  if (card === undefined) return JSON.stringify({ cardAfterClicking: false, says: 'no Wren to click' }, null, 1)
  card.click()
  await new Promise(r => setTimeout(r, 1200))
  const found = document.querySelector('[aria-label="Approval required"]')
  return JSON.stringify({
    cardAfterClicking: found !== null,
    says: found === null ? '' : found.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160)
  }, null, 1)
})()`

const approveEverything = `(async () => {
  let approved = 0
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const card = document.querySelector('[aria-label="Approval required"]')
    if (card !== null) {
      const yes = [...card.querySelectorAll('.lc-approval__actions button')].find(b => /approve/i.test(b.innerText))
      if (yes !== undefined) { yes.click(); approved += 1 }
    }
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1500))
  return String(approved)
})()`

try {
  await drive.capture('the routine runs, and the sidebar says a person is needed', async () => {
    await drive.ready()
    const pressed = await drive.evaluate(pressRun)
    if (pressed !== 'pressed') return `NOT THE TEST: ${String(pressed)}`
    return drive.evaluate(waitForTheAsk)
  })

  await drive.capture('clicking the teammate reaches the card', async () => drive.evaluate(openTheTeammate))

  const sawCard = await drive.evaluate(`document.querySelector('[aria-label="Approval required"]') !== null`)
  if (sawCard !== true) {
    throw new Error('NOT THE TEST: no card even after opening the teammate, so the refusal I removed was load-bearing')
  }

  await drive.capture('approving lets the routine finish its step', async () => {
    const approved = await drive.evaluate(approveEverything)
    let wrote = 'NOT WRITTEN'
    try {
      wrote = (await readFile(join(workspace, 'ROUTINE.txt'), 'utf8')).trim()
    } catch {
      // The file is the point; its absence is the finding.
    }
    return JSON.stringify({ approved, fileOnDisk: wrote }, null, 1)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Codex CLI / gpt-5.6-luna in Approve-each, with a saved routine that writes a file. Run is pressed from the Team screen, then the whole path a person walks is driven: the sidebar says "waiting on you", the click reaches the card, approving finishes the step.'
  })
}
