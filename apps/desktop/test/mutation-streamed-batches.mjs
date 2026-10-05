// Focused controls for the streaming-cost handoff. Run from apps/desktop.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const report = join(root, 'streaming-mutation-result.json')
const batches = 'src/main/streamed-event-batches.ts'
const durable = 'src/main/durable-event-updates.ts'
const updates = 'src/shared/streamed-updates.ts'
const fragments = 'src/shared/messageFragments.ts'
const missions = 'src/main/codex-mission.ts'
const permission = 'src/main/permission-host.ts'
const tests = ['src/main/a-streamed-batch-is-written-before-it-is-shown.test.ts', 'src/renderer/src/a-streamed-batch-keeps-the-whole-answer.test.ts', 'src/main/codex-mission.test.ts', 'src/main/permission-host.test.ts']
const mutations = [
  { file: durable, name: 'emit before the durable append',
    from: '  await ledger.appendEvents(missionId, events)',
    to: '  for (const update of streamedUpdates(runId, missionId, events)) emit(update)\n  await ledger.appendEvents(missionId, events)',
    expect: 'reads the entire batch from disk at send time and recovers it after a crash before send' },
  { file: durable, name: 'track before the durable append, losing the last batch on a crash',
    from: '  await ledger.appendEvents(missionId, events)\n  track(events)',
    to: '  track(events)\n  await ledger.appendEvents(missionId, events)',
    expect: 'reads the entire batch from disk at send time and recovers it after a crash before send' },
  { file: batches, name: 'activity waits behind the text timer',
    from: "events.some((event) => event.type !== 'message.delta')",
    to: "events.some((event) => false)",
    expect: 'flushes text ahead of activity immediately and preserves order across both batches' },
  { file: batches, name: 'a lone delta misses its deadline', from: '        }, windowMs)', to: '        }, windowMs + 1)',
    expect: 'delivers a lone delta at the deadline without another record or a run ending' },
  { file: batches, name: 'process exit drops a pending batch',
    from: 'while (!stopped && (waiting.length > 0 || writer !== undefined))',
    to: 'while (!stopped && writer !== undefined)',
    expect: 'writes pending text before a run ending and drains the last fragment on process exit' },
  { file: updates, name: 'run ending overtakes the text ahead of it',
    from: "      flush()\n      updates.push({ kind: 'event', runId, missionId, event })",
    to: "      updates.push({ kind: 'event', runId, missionId, event })\n      flush()",
    expect: 'writes pending text before a run ending and drains the last fragment on process exit' },
  { file: updates, name: 'the IPC batch drops all but the first fragment', from: 'events: deltas', to: 'events: deltas.slice(0, 1)',
    expect: 'sends one message for consecutive deltas, retaining every identity and activity boundary' },
  { file: fragments, name: 'the renderer applies a batch backwards', from: 'for (const arriving of arrivals)', to: 'for (const arriving of [...arrivals].reverse())',
    expect: 'folds append, replace, final and several messages exactly as individual arrivals do without changing inputs' },
  { file: missions, name: 'an approval card overtakes pending text',
    from: '          await active.get(runId)?.flushEvents?.()', to: '          await Promise.resolve()',
    expect: 'shows pending text durably before an approval card without waiting for the text deadline' },
  { file: permission, name: 'a Claude approval skips the flush and outlives its run',
    from: '      await registered.beforeApproval?.()', to: '      void registered.beforeApproval?.()',
    expect: 'waits for pending text before raising a Claude approval and refuses one whose run ended while waiting' },
  { file: fragments, name: 'the renderer caps only after the entire batch, losing a message that spoke again',
    from: 'if (next.length > cap) next.splice(1, next.length - cap)', to: 'if (false) next.splice(1, next.length - cap)',
    expect: 'matches the live cap after each fragment when an evicted message speaks again in the same batch' },
  { file: batches, name: 'text after an approval flush never gets a new timer',
    from: '      ready = false\n    },\n    get pendingCount', to: '      ready = true\n    },\n    get pendingCount',
    expect: 'starts a new text deadline after an approval flush waited on an in-flight write' }
]
const originals = new Map(mutations.map(({ file }) => [file, readFileSync(join(root, file), 'utf8')]))
const run = () => {
  rmSync(report, { force: true })
  const child = spawnSync('npx', ['vitest', 'run', ...tests, '--reporter=json', '--outputFile=streaming-mutation-result.json'], { cwd: root, shell: true, encoding: 'utf8' })
  if (!existsSync(report)) throw new Error(`No test report, exit ${String(child.status)}: ${child.stderr}`)
  const data = JSON.parse(readFileSync(report, 'utf8'))
  const assertions = data.testResults.flatMap((file) => file.assertionResults)
  return { total: data.numTotalTests, failed: assertions.filter((test) => test.status === 'failed').map((test) => test.title) }
}
try {
  const baseline = run()
  if (baseline.failed.length > 0) throw new Error(`Baseline failed: ${baseline.failed.join(', ')}`)
  console.log(`BASELINE: ${baseline.total} passed`)
  for (const mutation of mutations) {
    const source = originals.get(mutation.file)
    if (!source.includes(mutation.from)) throw new Error(`Anchor missing: ${mutation.name}`)
    writeFileSync(join(root, mutation.file), source.replace(mutation.from, mutation.to))
    const result = run()
    writeFileSync(join(root, mutation.file), source)
    if (result.total !== baseline.total || !result.failed.includes(mutation.expect)) throw new Error(`Control survived or stopped running: ${mutation.name}; ${JSON.stringify(result)}`)
    console.log(`CAUGHT: ${mutation.name} -> ${mutation.expect}`)
  }
  console.log(`ALL ${mutations.length} CONTROLS CAUGHT`)
} finally {
  for (const [file, source] of originals) writeFileSync(join(root, file), source)
  rmSync(report, { force: true })
}
