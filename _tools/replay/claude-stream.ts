// Replay a Claude Code stream-json transcript through Locust's own adapter
// and thread, record by record, and write what a person would have seen:
// every record kind and what it became, the live line as it changed, the
// answer as it changed, and the finished thread and fold line.
//
// Item 6 of the 2026-09-22 plan (Colin: "i find it hard to believe ... after 8
// minutes of working thats the only info the user has been given"). Its first
// run, on a Bash-heavy Haiku run, found three things the thread lost or got
// wrong: every message after the first replaced the one before, a subagent's
// words took the teammate's place, and refused commands counted as run.
//
// Run through `_tools/replay-claude-stream.mjs`, which bundles this file.

import { readFileSync, writeFileSync } from 'node:fs'

import { createClaudeEventNormalizer } from '../../packages/runtime-adapters/src/claude-events.ts'
import { activityTrace, buildThread, traceOutcome } from '../../apps/desktop/src/renderer/src/missionView.ts'

const [input, output] = process.argv.slice(2)
const lines = readFileSync(input!, 'utf8').split('\n').filter((line) => line.trim().length > 0)
let clock = Date.UTC(2026, 8, 23, 12, 0, 0)
const normalizer = createClaudeEventNormalizer({ runId: 'replay', missionId: 'mission_replay', cliVersion: '2.1.280', now: () => new Date(clock) })

type Row = { index: number; kind: string; produced: string[]; live: string | undefined }
const rows: Row[] = []
const events: any[] = []
let lastLive: string | undefined
const liveTimeline: string[] = []
const answerTimeline: string[] = []
let lastSaid = ''
lines.forEach((line, index) => {
  clock += 250
  let parsed: any
  try { parsed = JSON.parse(line) } catch { parsed = {} }
  const kind = [parsed.type, parsed.subtype ?? parsed.event?.type ?? parsed.event?.delta?.type, parsed.parent_tool_use_id ? 'sub' : ''].filter(Boolean).join(':')
  const produced = normalizer.accept({ sequence: index + 1, raw: line })
  events.push(...produced)
  const items = buildThread(events, { running: true, mayEdit: true })
  const live = items.find((item: any) => item.type === 'live-step') as any
  const liveText = live === undefined ? undefined : `${live.register}: ${live.label}${live.detail ? ` · ${live.detail}` : ''}`
  const said = items.filter((item: any) => item.type === 'agent-message').map((item: any) => String(item.text).slice(0, 70)).join(' || ')
  if (said !== lastSaid) { answerTimeline.push(`#${index + 1} ${kind} -> [${said}]`); lastSaid = said }
  if (liveText !== lastLive) { liveTimeline.push(`#${index + 1} ${kind} -> ${liveText ?? '(no live line)'}`); lastLive = liveText }
  rows.push({ index: index + 1, kind, produced: produced.map((event: any) => event.type), live: liveText })
})
const done = normalizer.finish({ exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: lines.length, cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false, startedAt: new Date(Date.UTC(2026, 8, 23, 12)).toISOString(), finishedAt: new Date(clock).toISOString() } as any)
events.push(...done)

// Which record kinds produced nothing at all.
const byKind = new Map<string, { count: number; produced: Map<string, number> }>()
for (const row of rows) {
  const held = byKind.get(row.kind) ?? { count: 0, produced: new Map() }
  held.count += 1
  const key = row.produced.length === 0 ? '(nothing)' : row.produced.join('+')
  held.produced.set(key, (held.produced.get(key) ?? 0) + 1)
  byKind.set(row.kind, held)
}
const final = buildThread(events, { running: false, mayEdit: true })
const activity = final.find((item: any) => item.type === 'activity') as any
const report = {
  records: lines.length,
  terminal: done.map((event: any) => event.type),
  inventory: [...byKind].map(([kind, held]) => ({ kind, count: held.count, produced: Object.fromEntries(held.produced) })),
  liveTimeline,
  answerTimeline,
  finalItems: final.map((item: any) => ({ type: item.type, text: (item.text ?? item.message ?? item.label ?? '').toString().slice(0, 120) })),
  foldRows: activity?.details?.map((detail: any) => `${detail.kind}: ${detail.title ? `${detail.title} | ` : ''}${detail.name}${detail.failed ? ' [failed]' : ''}${detail.status ? ` (${detail.status})` : ''}`) ?? [],
  foldLine: activity === undefined ? '' : activityTrace(activity.details, events, traceOutcome(events, false), undefined, true).map((segment: any) => segment.text).join(' · '),
  notices: activity?.notices?.map((notice: any) => notice.message) ?? []
}
writeFileSync(output!, JSON.stringify(report, null, 2))
console.log(`records ${String(report.records)}, events ${String(events.length)}, terminal ${report.terminal.join(',')}`)
