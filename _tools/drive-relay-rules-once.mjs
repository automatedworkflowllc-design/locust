// Are the reply rules said once to each teammate in an exchange (A2.8), and
// does the exchange still work on the one-line reminder?
//
//   LOCUST_SPEND=1 node _tools/drive-relay-rules-once.mjs [--packaged <exe>] [--tag <name>]
//
// Wren asks Booty for three words, one at a time, so the exchange runs to
// about six automatic replies and each teammate has a SECOND reply turn --
// the one that gets the reminder instead of the rules. What each runtime was
// sent is read from Claude Code's own session files for the scratch folder;
// what came of it from Wren's thread. About seven Haiku turns.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace, teammateRows, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `relay-rules-once-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-rules-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { runtime: 'claude', model: 'haiku', mode: 'ask' }
const drive = await startDrive({
  name: 'relay-rules-once',
  port: 9540,
  workspace,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 8, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const busy = `${teammateRows()}.some(r => /working|running|starting|replying|listening|thinking|waiting/i.test(r.innerText))`
const LINE = 'The rules for replies from your earlier turn in this exchange still hold'
const FULL = 'reach nobody and cost a run each'

/** Every user message Claude Code's sessions for the scratch folder hold, oldest first. */
async function sent() {
  const folder = join(homedir(), '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'))
  const out = []
  for (const file of (await readdir(folder).catch(() => [])).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(folder, file), 'utf8')).split('\n')) {
      if (line.trim().length === 0) continue
      let record
      try { record = JSON.parse(line) } catch { continue }
      if (record.type !== 'user' || record.isMeta === true) continue
      const content = record.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : ''
      if (text.length > 0) out.push({ at: record.timestamp ?? '', file, text })
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

try {
  await drive.capture('launch: Wren and Booty on Claude Haiku, replies on, budget 8', () => drive.ready())
  await drive.capture('Wren is asked to get three words from Booty, one at a time', () => drive.evaluate(`(async () => {
    window.__updates = []
    window.desktop.onCodexMissionUpdate(u => { if (u.kind !== 'event') window.__updates.push({ kind: u.kind, message: u.message, teammateId: u.teammateId, startedBy: u.startedBy }) })
    const wren = ${teammateFace('Wren')}
    wren.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Get three words from your teammate Booty, one at a time, with the share block each time: first ask Booty only for the name of a fruit. When Booty answers, ask only for a colour. When Booty answers that, ask only for an animal. Once you have all three, tell me the three words in one line and stop. Do not read or edit any files.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  await drive.capture('wait for the whole exchange to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 1200; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 60 && !document.querySelector('button[aria-label^="Stop the running"]') && !${busy}) return 'settled after ' + String(i / 2) + 's'
    }
    return 'still going'
  })()`))
  const updates = JSON.parse(String(await drive.evaluate(`JSON.stringify(window.__updates ?? [])`)))
  if (outPath !== undefined) await writeFile(join(outPath, 'host-updates.json'), JSON.stringify(updates, null, 2), 'utf8')
  const relayed = updates.filter((u) => u.kind === 'mission-started' && u.startedBy?.kind === 'relay').map((u) => `${u.teammateId}@${String(u.startedBy.hop)}`)
  const thread = String(await drive.capture("Wren's thread at the end", () => drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-700)`)))
  const turns = await sent()
  const reminded = turns.filter((entry) => entry.text.includes(LINE))
  const told = turns.filter((entry) => entry.text.includes(FULL))
  if (outPath !== undefined) {
    await writeFile(join(outPath, 'what-each-turn-was-sent.json'), JSON.stringify(turns.map((entry) => ({ at: entry.at, session: entry.file, characters: entry.text.length, rules: entry.text.includes(FULL), reminder: entry.text.includes(LINE), opens: entry.text.slice(0, 90) })), null, 2), 'utf8')
  }
  say(`relayed runs: ${relayed.join(', ')} || turns sent: ${String(turns.length)}; full rules: ${String(told.length)}; reminders: ${String(reminded.length)}`)
  check('the exchange reached a second reply turn for someone', relayed.length >= 4, relayed.join(', '))
  check('a second reply turn got the reminder, not the rules again', reminded.length >= 1 && reminded.every((entry) => !entry.text.includes(FULL)), `${String(reminded.length)} reminders`)
  check('each teammate got the full rules at most once', new Set(told.map((entry) => entry.file)).size === told.length, told.map((entry) => entry.file).join(', '))
  check('and the exchange still finished with the three words', /fruit|colou?r|animal/i.test(thread) || relayed.length >= 5, thread.slice(-300))
  say(failures === 0 ? '\nRELAY RULES ONCE PASSED' : `\nRELAY RULES ONCE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Booty on Claude Haiku (Ask), replies on, budget 8; three words from Booty, one at a time.` })
}
