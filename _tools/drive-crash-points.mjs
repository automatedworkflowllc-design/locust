// Killed at several different moments, not one.
//
//   node _tools/drive-crash-points.mjs
//
// `drive-interrupted` force-quits Electron mid-run and reopens it, which is
// the right shape and the only crash test here. It kills at ONE moment, after
// a fixed wait, so it exercises one phase of a run and calls it covered.
//
// The phases that differ are the ones with a write in flight: before the
// first event is persisted, part-way through a stream of them, and just as
// the closing receipt lands. A kill during an append is also the only way to
// test the ledger's crash-consistency claim for real -- it says an
// unparseable line and its tail are dropped with an issue raised, and that
// has been read in the source but never produced.
//
// So: the same run, killed at several delays, each time relaunched on the same
// profile. For each, three questions --
//   does the app come back at all
//   is the mission's state honest about what happened
//   does the ledger still parse, and if a line was torn, is it SAID
//
// Free OpenCode model, so the runs cost nothing.

import { readdir, readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

// Chosen to straddle the phases: before anything is written, during the
// stream, and late enough that a closing receipt may be in flight.
const KILL_AFTER_MS = [800, 3000, 8000, 15000]

const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

/** Every ledger file, and whether each one still reads as JSON lines. */
const ledgerHealth = async (profile) => {
  const root = join(profile, 'mission-ledger')
  const names = await readdir(root).catch(() => [])
  const files = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const text = await readFile(join(root, name), 'utf8').catch(() => '')
    const lines = text.split('\n').filter((line) => line.trim().length > 0)
    let torn = 0
    for (const line of lines) {
      try {
        JSON.parse(line)
      } catch {
        torn += 1
      }
    }
    files.push({ name: name.slice(0, 16), lines: lines.length, torn })
  }
  return files
}

const findings = []

for (const killAfter of KILL_AFTER_MS) {
  const workspace = await scratchRepository('locust-crash-ws-')
  const profile = await mkdtemp(join(tmpdir(), 'locust-crash-'))
  let drive = await startDrive({ name: 'crash-points', port: 9409, workspace, profilePath: profile, seed, keep: true })
  let handoff

  try {
    await drive.capture(`killed ${String(killAfter)}ms in: start a run`, async () => {
      await drive.ready()
      await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
      await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
      await drive.evaluate(`(async () => {
        const box = document.querySelector('textarea[aria-label="Mission instruction"]')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(box, 'Count slowly from 1 to 60, one number per line, then say done.')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 200))
        box.focus()
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        return 'sent'
      })()`)
      await new Promise((resolve) => setTimeout(resolve, killAfter))
      return `killing now, ${String(killAfter)}ms after send`
    })
    handoff = await drive.finish({ intro: `Killed ${String(killAfter)}ms after the run started.`, last: false })
  } catch (error) {
    say(`first half failed at ${String(killAfter)}ms: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  const health = await ledgerHealth(profile)

  drive = await startDrive({
    name: 'crash-points',
    port: 9409,
    workspace,
    profilePath: profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  try {
    const seen = await drive.capture(`killed ${String(killAfter)}ms in: what it says on relaunch`, async () => {
      await drive.ready()
      return drive.evaluate(`(async () => {
        document.querySelector('button[title="All missions (Ctrl 1)"]')?.click()
        await new Promise(r => setTimeout(r, 1500))
        const body = document.body.innerText
        return JSON.stringify({
          // An interrupted run must not read as finished, and must not vanish.
          saysInterrupted: /interrupted|could not continue|stopped/i.test(body),
          saysCompleted: /completed/i.test(body),
          missionsListed: document.querySelectorAll('.lc-missionrow, .lc-mission').length,
          // Anything the app noticed about its own record.
          saysLedgerTrouble: /could not be read|invalid mission record|oversized/i.test(body)
        })
      })()`)
    })
    findings.push({ killAfter, ledger: health, screen: String(seen) })
  } finally {
    await drive.finish({ intro: `Relaunched after the ${String(killAfter)}ms kill.` })
  }
}

say('')
say('=== every kill point ===')
for (const finding of findings) {
  const torn = finding.ledger.reduce((total, file) => total + file.torn, 0)
  const lines = finding.ledger.reduce((total, file) => total + file.lines, 0)
  say(`${String(finding.killAfter)}ms: ${String(finding.ledger.length)} ledger file(s), ${String(lines)} lines, ${String(torn)} torn`)
  say(`        ${finding.screen}`)
}
say('done')
