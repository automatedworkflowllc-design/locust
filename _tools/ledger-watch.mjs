// Read the real ledger and say what a person would have noticed.
//
//   node _tools/ledger-watch.mjs                      Colin's profile
//   node _tools/ledger-watch.mjs <mission-ledger dir>  any profile
//
// Written 2026-09-16 after reading the ledger by hand at 5am found a chain
// that finished exactly as briefed and gave the person nothing: Jimothy was
// asked to get a brief from Wembley and get back to Colin; the brief came
// back; Jimothy ended with a memory note and not one word. No test reads the
// ledger for "did the person get answered", so this does. Read-only.
//
// It flags, most embarrassing first:
//   1. a run with no terminal event -- died silently, whatever the screen said
//   2. a reply that landed in the person's conversation and said nothing
//      visible to them (only protocol blocks, or nothing at all)
//   3. an exchange that stopped because the budget ran out
//   4. a reply that never came back (`host.relay_ended`)

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dir = process.argv[2] ?? join(homedir(), 'AppData', 'Roaming', '@teammate', 'desktop', 'mission-ledger').replace(/\\/g, '/')

const BLOCK = /<locust-(share|memory|ask|todo|plan)\b[\s\S]*?<\/locust-\1>/g
/** What a person would see of a final message once the protocol is taken out. */
export const visibleText = (text) => text.replace(BLOCK, '').replace(/\s+/g, ' ').trim()

const missions = []
for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
  let rows
  try {
    rows = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    continue
  }
  const created = rows.find((row) => row.recordType === 'mission.created')
  if (created === undefined) continue
  const events = rows.filter((row) => row.event).map((row) => row.event)
  const terminal = [...events].reverse().find((event) => /^run\.(completed|failed|cancelled)$/.test(event.type))
  const texts = events.filter((event) => event.type === 'message.delta' && typeof event.payload?.text === 'string').map((event) => event.payload.text)
  const notices = events.filter((event) => event.type === 'adapter.diagnostic').map((event) => ({ code: event.payload?.code ?? '', message: event.payload?.message ?? '' }))
  missions.push({
    id: created.metadata.missionId,
    at: created.occurredAt,
    runtime: created.metadata.runtime,
    prompt: created.metadata.prompt ?? '',
    continuesFrom: created.metadata.continuesFrom?.missionId,
    relayHop: created.metadata.relay?.hop,
    terminal: terminal?.type,
    lastEvent: events.at(-1)?.type,
    lastAt: rows.at(-1)?.occurredAt,
    final: texts.at(-1) ?? '',
    notices
  })
}
missions.sort((a, b) => (a.at < b.at ? -1 : 1))
const byId = new Map(missions.map((mission) => [mission.id, mission]))

/** Walk `continuesFrom` back to the mission a person typed. */
const rootOf = (mission) => {
  let current = mission
  const seen = new Set()
  while (current.continuesFrom !== undefined && byId.has(current.continuesFrom) && !seen.has(current.id)) {
    seen.add(current.id)
    current = byId.get(current.continuesFrom)
  }
  return current
}
/** A mission a person typed: not a host briefing. */
const personTyped = (mission) => !/^\S.* \(.*\) (sent you a message|replied to you)/.test(mission.prompt) && !/replied to your message/.test(mission.prompt)

const findings = []
for (const mission of missions) {
  const when = mission.at.slice(0, 16).replace('T', ' ')
  const head = `${when} ${mission.runtime} ${mission.id.slice(0, 16)}`
  if (mission.terminal === undefined) {
    findings.push({ rank: 1, line: `${head} — NO TERMINAL EVENT. Last: ${mission.lastEvent ?? 'nothing'} at ${mission.lastAt?.slice(11, 19) ?? '?'}. Prompt: "${mission.prompt.slice(0, 60)}"` })
  }
  const isReply = /replied to you; it is quoted below/.test(mission.prompt)
  if (isReply && mission.terminal === 'run.completed') {
    // Landed in the person's conversation when its root was typed by a person.
    const root = rootOf(mission)
    if (root !== mission && personTyped(root)) {
      const said = visibleText(mission.final)
      if (said.length === 0) {
        findings.push({ rank: 2, line: `${head} — reply landed in the person's conversation ("${root.prompt.slice(0, 50)}") and said NOTHING visible to them${mission.final.length > 0 ? ' (only protocol blocks)' : ''}` })
      }
    }
  }
  for (const notice of mission.notices) {
    if (/budget|automatic repl(y|ies)|cap of/i.test(notice.message) && /stopp|no more|reached|ended/i.test(notice.message)) {
      findings.push({ rank: 3, line: `${head} — exchange hit its budget: ${notice.message.slice(0, 120)}` })
    } else if (notice.code === 'host.relay_ended') {
      // The host's own notice, recorded in the conversation it was shown in -- so the head names where it LANDED, not who it is about.
      findings.push({ rank: 4, line: `${head} — notice shown here: ${notice.message.slice(0, 120)}` })
    }
  }
}
findings.sort((a, b) => a.rank - b.rank || a.line.localeCompare(b.line))

const counts = missions.reduce((held, mission) => ({ ...held, [mission.terminal ?? 'no-terminal']: (held[mission.terminal ?? 'no-terminal'] ?? 0) + 1 }), {})
console.log(`${String(missions.length)} missions in ${dir}`)
console.log(Object.entries(counts).map(([key, value]) => `${key}: ${String(value)}`).join(' · '))
console.log('')
if (findings.length === 0) console.log('Nothing a person would have noticed.')
for (const finding of findings) console.log(`${String(finding.rank)}. ${finding.line}`)
