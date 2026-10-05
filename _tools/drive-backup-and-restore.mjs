// BACK UP AND RESTORE, THE WHOLE ROUND TRIP, ON THE BUILT APP (0.614; the PRD's R21).
//
//   node _tools/drive-backup-and-restore.mjs [--packaged <exe>] [--tag <name>]
//
// Profile A (Wren and Atlas, two conversations, a key in own-models.json) backs up from
// Settings > Privacy & data; the folder on disk is read: a manifest, no key anywhere. Profile B
// (Juno) restores it from the same section: the preview says what the backup holds and what it
// replaces; "Restore and restart" restarts Locust, which applies the restore before reading its
// profile. The relaunched app is reached on the same debugging port (it is not the drive's own
// child any more): it must show Wren and Atlas, say what it restored, and keep Juno aside.
//
// The native folder picker is answered by LOCUST_TEST_PICK_FOLDER, a file whose text is the
// folder picked (a test seam in main, as LOCUST_INSTALL_DIR is). Spends nothing.

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SCRATCH_ROOT } from './scratch-root.mjs'
import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'dev' : 'packaged')
const OUT = join(recordRoot('backup-and-restore'), tag)
await mkdir(OUT, { recursive: true })
const BACKUPS = await mkdtemp(join(SCRATCH_ROOT, 'locust-drive-backups-'))
const PICK = join(await mkdtemp(join(SCRATCH_ROOT, 'locust-drive-pick-')), 'pick.txt')
const KEY = 'sk-live-DRIVE-KEY-THAT-MUST-NEVER-BE-COPIED'
const PORT_B = 9883

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const at = '2026-09-10T09:00:00.000Z'
const mate = (teammateId, name, hue) => ({ teammateId, name, hue, role: 'Code & Migrations', createdAt: at, route: FREE_ROUTE })
const line = (value) => JSON.stringify(value) + '\n'
const ledgerFile = (workspace, missionId, prompt) => {
  const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
  const runId = `run_${missionId.slice(2)}`
  const metadata = { missionId, runId, prompt, runtime: 'opencode', model: FREE_ROUTE.model, requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: '1.18.27', workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at }
  const header = { schemaVersion: 15, recordType: 'mission.created', ledgerSequence: 1, occurredAt: at, metadata }
  const events = [
    { type: 'run.started', payload: {} },
    { type: 'message.delta', payload: { itemId: 'answer_1', operation: 'append', text: 'Done.', final: true } },
    { type: 'run.completed', payload: { status: 'completed' } }
  ].map((event, index) => ({ schemaVersion: 15, recordType: 'mission.event', ledgerSequence: index + 2, occurredAt: at, event: { id: `event_${missionId}_${String(index)}`, runId, missionId, sequence: index + 1, occurredAt: at, sourceAdapter: 'opencode', ...event } }))
  return line(header) + events.map(line).join('')
}

/** Settings > Privacy & data, then the section's own state. */
const openPrivacy = (drive) => drive.evaluate(`(async () => {
  document.querySelector('button[title="Settings (Ctrl 3)"]')?.click()
  await new Promise((r) => setTimeout(r, 900))
  ;[...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.replace(/\\s+/g, ' ').trim().startsWith('Privacy & data'))?.click()
  await new Promise((r) => setTimeout(r, 700))
  return JSON.stringify({
    headings: [...document.querySelectorAll('.lc-settings__heading')].map((h) => h.textContent.trim()),
    buttons: [...document.querySelectorAll('.lc-backup button')].map((b) => b.innerText.trim())
  })
})()`)
const press = (drive, label, waitFor) => drive.evaluate(`(async () => {
  ;[...document.querySelectorAll('.lc-backup button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})?.click()
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const seen = ${waitFor}
    if (seen) return seen
  }
  return 'nothing came: ' + (document.querySelector('.lc-backup')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no section')
})()`)

/** The relaunched app is no child of this drive: it is reached on its port, as DevTools would. */
async function cdp(port, method, params, browser = false) {
  let target
  for (let i = 0; i < 120 && target === undefined; i += 1) {
    try {
      target = browser
        ? (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()).webSocketDebuggerUrl
        : (await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()).find((t) => t.type === 'page' && !/#splash/.test(t.url))?.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    if (target === undefined) await sleep(500)
  }
  if (target === undefined) throw new Error(`nothing answered on port ${String(port)}`)
  const socket = new WebSocket(target)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const answer = await new Promise((resolve) => {
    socket.onmessage = (message) => { const data = JSON.parse(String(message.data)); if (data.id === 1) resolve(data) }
    socket.send(JSON.stringify({ id: 1, method, params }))
    if (method === 'Browser.close') setTimeout(() => resolve({}), 1500)
  })
  socket.close()
  return answer
}

try {
  // A: back up.
  const workspaceA = await scratchRepository('locust-drive-backup-ws-a-')
  const driveA = await startDrive({
    name: `backup-a-${tag}`, port: 9882, workspace: workspaceA, outPath: join(OUT, 'a'), sendsNothing: true,
    env: { LOCUST_TEST_PICK_FOLDER: PICK },
    files: {
      'mission-ledger/m_backup1.jsonl': ledgerFile(workspaceA, 'm_backup1', 'Move the release notes'),
      'mission-ledger/m_backup2.jsonl': ledgerFile(workspaceA, 'm_backup2', 'Summarise the rulings'),
      'own-models.json': JSON.stringify({ schemaVersion: 1, models: [], note: KEY })
    },
    ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates: [mate('tm_wren', 'Wren', 'lime'), mate('tm_atlas', 'Atlas', 'blue')], missionOwners: { m_backup1: 'tm_wren', m_backup2: 'tm_atlas' }, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
  })
  try {
    await driveA.ready()
    await driveA.resize(1440, 900)
    const shown = JSON.parse(String(await openPrivacy(driveA)))
    check('Settings > Privacy & data has a Back up and restore section with its two buttons', shown.headings.includes('Back up and restore') && shown.buttons.includes('Back up…') && shown.buttons.includes('Restore from a backup…'), JSON.stringify(shown))
    await writeFile(PICK, BACKUPS)
    const done = String(await driveA.capture('A: backed up', () => press(driveA, 'Back up…', `[...document.querySelectorAll('.lc-backup .lc-settings__note')].map((n) => n.innerText).find((t) => /^Backed up|could not|refused/i.test(t))`)))
    say(`  A says: ${done}`)
    check('the backup says what it holds and where', /^Backed up 2 teammates and 2 conversations \(.+\) to "Locust backup \d{4}-\d\d-\d\d \d{4}"\.$/.test(done), done)
  } finally {
    await driveA.finish({ intro: `Build: ${packaged ?? 'out/'}. Back up and restore, profile A.`, extra: '' })
  }
  const made = (await readdir(BACKUPS)).filter((name) => name.startsWith('Locust backup '))
  check('one backup folder was made, in the folder picked', made.length === 1, JSON.stringify(made))
  const backupFolder = join(BACKUPS, made[0] ?? 'none')
  const manifest = JSON.parse(await readFile(join(backupFolder, 'locust-backup.json'), 'utf8'))
  const texts = []
  const walk = async (dir) => { for (const entry of await readdir(dir, { withFileTypes: true })) entry.isDirectory() ? await walk(join(dir, entry.name)) : texts.push(await readFile(join(dir, entry.name), 'utf8')) }
  await walk(backupFolder)
  check('the key is nowhere in the backup, and own-models.json is not in it', !texts.join('\n').includes(KEY) && !manifest.files.some((file) => file.path === 'own-models.json'), JSON.stringify(manifest.files.map((file) => file.path)))

  // B: restore.
  const profileB = await mkdtemp(join(SCRATCH_ROOT, 'locust-drive-backup-b-'))
  const workspaceB = await scratchRepository('locust-drive-backup-ws-b-')
  const driveB = await startDrive({
    name: `backup-b-${tag}`, port: PORT_B, workspace: workspaceB, profilePath: profileB, keep: true, outPath: join(OUT, 'b'), sendsNothing: true,
    env: { LOCUST_TEST_PICK_FOLDER: PICK },
    ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates: [mate('tm_juno', 'Juno', 'violet')], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
  })
  try {
    await driveB.ready()
    await driveB.resize(1440, 900)
    await openPrivacy(driveB)
    await writeFile(PICK, backupFolder)
    const preview = String(await driveB.capture('B: the restore previewed', () => press(driveB, 'Restore from a backup…', `document.querySelector('.lc-backup__plan')?.innerText.replace(/\\s+/g, ' ').trim()`)))
    say(`  B's preview: ${preview}`)
    check('the preview says what the backup holds and what it replaces', /Holds 2 teammates and 2 conversations/i.test(preview) && /Replaces 1 teammate, here now/i.test(preview) && /moved aside/.test(preview), preview)
    await driveB.evaluate(`[...document.querySelectorAll('.lc-backup button')].find((b) => b.innerText.trim() === 'Restore and restart')?.click()`)
    await sleep(1500)
  } finally {
    await driveB.finish({ intro: `Build: ${packaged ?? 'out/'}. Back up and restore, profile B, before its restart.`, extra: '' })
  }
  // The relaunched app, on the same port: the restore applied before it read anything.
  const after = (await cdp(PORT_B, 'Runtime.evaluate', {
    expression: `(async () => {
      for (let i = 0; i < 120; i += 1) {
        const notice = document.querySelector('.lc-restored')?.innerText.replace(/\\s+/g, ' ').trim()
        const team = [...document.querySelectorAll('.lc-hometeam__name')].map((n) => n.firstChild?.textContent?.trim() ?? '')
        // The notice comes first; the team's cards once the agents are found.
        if (notice && team.length > 0) return JSON.stringify({ notice, team })
        await new Promise((r) => setTimeout(r, 250))
      }
      return JSON.stringify({ notice: null, team: [...document.querySelectorAll('.lc-hometeam__name')].map((n) => n.firstChild?.textContent?.trim() ?? '') })
    })()`,
    awaitPromise: true,
    returnByValue: true
  }))?.result?.result?.value
  const seen = JSON.parse(String(after ?? '{}'))
  say(`  after the restart: ${JSON.stringify(seen)}`)
  check('after the restart Locust says what it restored', /^Restored 2 teammates and 2 conversations from "Locust backup .+"\. What was here before is kept in "before-restore-\d{8}-\d{6}"/.test(seen.notice ?? ''), seen.notice)
  check('and the team is the backup\'s', JSON.stringify([...(seen.team ?? [])].sort()) === JSON.stringify(['Atlas', 'Wren']), JSON.stringify(seen.team))
  const aside = (await readdir(profileB)).filter((name) => name.startsWith('before-restore-'))
  const asideTeam = aside.length === 1 ? JSON.parse(await readFile(join(profileB, aside[0], 'teammates.json'), 'utf8')).teammates.map((one) => one.name) : []
  check('what was here before is kept aside, not deleted', JSON.stringify(asideTeam) === JSON.stringify(['Juno']), JSON.stringify({ aside, asideTeam }))
  await cdp(PORT_B, 'Browser.close', {}, true).catch((error) => say(`  closing the relaunched app: ${String(error)}`))
  await sleep(1500)
  await rm(profileB, { recursive: true, force: true }).catch(() => undefined)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await rm(BACKUPS, { recursive: true, force: true }).catch(() => undefined)
  await rm(join(PICK, '..'), { recursive: true, force: true }).catch(() => undefined)
}
say(failures === 0 ? '\nBACK UP AND RESTORE PASSED' : `\nBACK UP AND RESTORE: ${String(failures)} FAILED`)
process.exit(failures === 0 ? 0 : 1)
