// Mutation control for the mission-store suites (checkpoint + schema versions).
//
// A passing suite is only evidence if it could have failed. This breaks one
// behaviour at a time in the engine, runs the suite, and requires the EXPECTED
// test to fail -- not merely that something failed, because a mutation that
// makes the file unparseable fails everything while verifying nothing.
//
//   node test/mutation-control.mjs
//
// Restores every file it touches, including on error. Exits non-zero if any
// mutation survives, or if a mutation fails for the wrong reason.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHECKPOINT = join(ROOT, 'src', 'checkpoint.ts')
const INDEX = join(ROOT, 'src', 'index.ts')
const WORKROOM = join(ROOT, 'src', 'workroom.ts')

const MUTATIONS = [
  {
    file: INDEX,
    name: 'the home list stats every ledger at once',
    from: `const stamped = await mapLimited(allIds, READ_CONCURRENCY, async (missionId) => {
          try {
            const file = await stat(missionPath(rootDirectory, missionId))
            return { missionId, modifiedAt: file.mtimeMs }
          } catch {
            // Unreadable now is likely unreadable in a moment; sort it last
            // rather than dropping it, so it can still surface its own issue.
            return { missionId, modifiedAt: 0 }
          }
        })`,
    to: `const stamped = await Promise.all(allIds.map(async (missionId) => {
          try {
            const file = await stat(missionPath(rootDirectory, missionId))
            return { missionId, modifiedAt: file.mtimeMs }
          } catch {
            // Unreadable now is likely unreadable in a moment; sort it last
            // rather than dropping it, so it can still surface its own issue.
            return { missionId, modifiedAt: 0 }
          }
        }))`,
    expect: 'lists all 40 ledgers in order with no more than 16 reads or stats in flight'
  },
  {
    file: INDEX,
    name: 'a name occupied by something unreadable is skipped in silence',
    from: '        const unreadable = [...occupied, ...held',
    to: '        const unreadable = [...held',
    expect: 'deletes nothing at all while any ledger cannot be read'
  },
  {
    file: INDEX,
    name: 'a prune runs while a mission is being written, outside the queue',
    from: '      return serialize(async () => {\n        let entries',
    to: '      return (async () => {\n        let entries',
    expect: 'deletes only the missions the confirmation named, whatever else has aged'
  },
  {
    file: INDEX,
    name: 'a file the full reader refuses contributes no link, so its parent is deleted',
    from: '          const hint = mission === undefined ? await continuationHint(missionId) : { ok: true as const }',
    to: '          const hint = { ok: true as const }',
    expect: 'protects an old parent named by a file the full reader refuses'
  },
  {
    file: INDEX,
    name: 'a prune deletes anyway when a ledger cannot be opened at all',
    from: '        if (unreadable.length > 0) {\n          return { deleted: [], failed: [], unreadable, keptForContinuity: [], keptAsRunning: [] }\n        }\n',
    to: '',
    expect: 'deletes nothing at all while any ledger cannot be read'
  },
  {
    file: INDEX,
    name: 'a confirmation deletes everything old, not only what it showed',
    from: '          if (!old || (only !== undefined && !only.has(entry.missionId))) {',
    to: '          if (!old) {',
    expect: 'deletes only the missions the confirmation named, whatever else has aged'
  },
  {
    file: INDEX,
    name: 'one file that cannot be deleted throws away the record of the ones that were',
    from: '          try {\n            if (await removeMissionFile(missionId)) deleted.push(missionId)\n          } catch {\n            failed.push(missionId)\n          }',
    to: '          if (await removeMissionFile(missionId)) deleted.push(missionId)',
    expect: 'reports a file it could not delete instead of losing the ones it did'
  },
  {
    file: INDEX,
    name: 'the storage report leaves an unreadable file out of its own count',
    from: '          unreadableCount += 1\n          return',
    to: '          return',
    expect: 'counts a file it cannot read separately, instead of leaving it out of a date it is inside'
  },
  {
    file: INDEX,
    name: 'the history is dated by the file timestamp rather than the record',
    from: '        const updatedAt = parsed.mission === undefined ? undefined : Date.parse(parsed.mission.lastUpdatedAt)',
    to: '        const updatedAt = Date.now()',
    expect: 'counts the missions and their bytes, and dates the oldest by the record a prune would judge'
  },
  {
    file: INDEX,
    name: 'a preview deletes the files it is only supposed to describe',
    from: '          if (options.dryRun === true) {\n            deleted.push(missionId)\n            continue\n          }\n',
    to: '',
    expect: 'previews exactly what it would delete, and deletes nothing'
  },
  {
    file: INDEX,
    name: 'a prune deletes the earlier turns of a conversation it is keeping',
    from: '            if (candidates.has(cursor)) {\n              candidates.delete(cursor)\n              keptForContinuity.add(cursor)\n            }\n',
    to: '',
    expect: 'keeps an old mission that a kept conversation continues from'
  },
  {
    file: INDEX,
    name: 'a prune walks back only one turn, not the whole conversation',
    from: '            cursor = parents.get(cursor)\n          }\n        }',
    to: '            cursor = undefined\n          }\n        }',
    expect: 'keeps the whole chain behind a kept mission, not just its parent'
  },
  {
    file: INDEX,
    name: 'a prune deletes a mission the caller said was running',
    from: '        if (running.has(entry.missionId)) {',
    to: '        if (false) {',
    expect: 'never deletes a mission the caller says is running'
  },
  {
    file: INDEX,
    name: 'a prune treats an unreadable file as old enough to delete',
    from: '        const old = entry.readable\n',
    to: '        const old = true || entry.readable\n',
    expect: 'leaves a file it cannot read alone rather than guessing its age'
  },
  {
    file: INDEX,
    name: 'a prune accepts a cutoff that is not a timestamp',
    from: "      const cutoff = Date.parse(requireTimestamp(options.before, 'before'))",
    to: '      const cutoff = Date.parse(options.before)',
    expect: 'refuses a cutoff that is not a timestamp'
  },
  {
    file: INDEX,
    name: 'a pre-v7 file may name a runtime no writer of its version knew',
    from: "  if (schemaVersion < 7 && candidate.runtime !== 'codex' && candidate.runtime !== 'claude') {\n    return undefined\n  }\n",
    to: '',
    expect: 'refuses a Gemini mission in a file written before version 7'
  },
  {
    file: INDEX,
    name: 'a pre-v6 file may call a continuation a follow-up',
    from: "  if (schemaVersion < 6 && candidate.continuesFrom?.reason === 'follow-up') {\n    return undefined\n  }\n",
    to: '',
    expect: 'refuses a follow-up in a file written before version 6'
  },
  {
    file: INDEX,
    name: 'any continuation reason is accepted',
    from: "      || (metadata.continuesFrom.reason !== 'route-switch' && metadata.continuesFrom.reason !== 'follow-up')",
    to: '      || false',
    expect: 'refuses a continuation reason it does not know'
  },
  {
    name: 'an action that never reported an outcome is dropped from the record',
    file: CHECKPOINT,
    from: '  const unsettledActions = [...open.values()]',
    to: '  const unsettledActions = ([] as UnsettledAction[])',
    expect: 'refuses to call a mission safe while an action never reported an outcome'
  },
  {
    name: 'an action that reported an outcome is not recorded as settled',
    file: CHECKPOINT,
    from: '    settled.add(event.payload.itemId)',
    to: '    void event.payload.itemId',
    expect: 'reports a settled mission as safe to resume elsewhere'
  },
  {
    name: 'a checkpoint may claim safety while listing an unknown action',
    file: CHECKPOINT,
    from: '  if (value.resumeSafety === \'safe\' && value.unsettledActions.length > 0) return undefined',
    to: '  void 0',
    expect: 'refuses a checkpoint that claims safety while listing an unknown action'
  },
  {
    name: 'the summary keeps only the last delta fragment',
    file: CHECKPOINT,
    from: '    const next = operation === \'replace\' ? text : `${buffers.get(itemId) ?? \'\'}${text}`',
    to: '    const next = text',
    expect: 'rebuilds an appended message rather than keeping only its last fragment'
  },
  {
    name: 'every transcript hashes the same',
    file: CHECKPOINT,
    from: '    hash.update(',
    to: '    void event; hash.update(',
    to2: '`${event.sequence}${SEP}${event.id}${SEP}${event.type}${SEP}`',
    replacement2: '\'constant\'',
    expect: 'gives different transcripts different digests'
  },
  {
    name: 'the digest drops its field separator',
    file: CHECKPOINT,
    from: '${event.sequence}${SEP}${event.id}${SEP}${event.type}${SEP}',
    to: '${event.sequence}${event.id}${event.type}',
    expect: 'gives different transcripts different digests'
  },
  {
    name: 'a damaged ledger is checkpointed anyway',
    file: INDEX,
    from: '        if (checkpoint.resumeSafety === \'unsafe\') return checkpoint',
    to: '        void 0',
    expect: 'reports an unreadable ledger as unsafe, and refuses to write past the break'
  },
  {
    name: 'the reader forgets how to read version 1',
    file: INDEX,
    from: '  return value === 1 || value === 2',
    to: '  return value === 2',
    expect: 'still recovers a mission recorded before the version bump'
  },
  {
    name: 'appends silently upgrade a version-1 file',
    file: INDEX,
    from: '            schemaVersion: hydrated.schemaVersion,',
    to: '            schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,',
    expect: 'appends to a version-1 mission in version 1, keeping the file walkable'
  },
  {
    name: 'records are checked against the writer version, not the file version',
    file: INDEX,
    from: '      || value.schemaVersion !== schemaVersion',
    to: '      || !isSupportedSchemaVersion(value.schemaVersion)',
    expect: 'stops recovery when a record disagrees with its file version'
  },
  {
    name: 'an event may come from a runtime the mission is not running',
    file: INDEX,
    from: '    || value.sourceAdapter !== metadata.runtime',
    to: '    || value.sourceAdapter !== \'codex\'',
    expect: 'accepts a Claude mission and its Claude events'
  },
  {
    name: 'a pre-v4 file may claim to continue another mission',
    file: INDEX,
    from: "  if (schemaVersion < 4 && candidate.continuesFrom !== undefined) {\n    return undefined\n  }\n",
    to: '',
    expect: 'refuses a pre-v4 file claiming to continue another mission'
  },
  {
    name: 'a continuation may name any mission id, traversal included',
    file: INDEX,
    from: "    requireSafeId(metadata.continuesFrom.missionId, 'continuesFrom.missionId')",
    to: '',
    expect: 'refuses a continuation that names an unsafe mission id'
  },
  {
    name: 'a continuation may point at a checkpoint epoch that never existed',
    file: INDEX,
    from: '      || metadata.continuesFrom.checkpointEpoch < 1',
    to: '      || metadata.continuesFrom.checkpointEpoch < 0',
    expect: 'refuses a continuation with an impossible checkpoint epoch'
  },
  {
    name: 'a version-1 file may describe a runtime version 1 could not write',
    file: INDEX,
    from: '  if (schemaVersion === 1 && (candidate.runtime !== \'codex\' || candidate.model !== \'account-default\')) {\n    return undefined\n  }\n',
    to: '',
    expect: 'refuses a version-1 file describing a runtime version 1 could not write'
  },
  {
    name: 'recovery accepts an out-of-order checkpoint epoch',
    file: INDEX,
    from: '        || checkpoint.epoch !== checkpoints.length + 1\n',
    to: '',
    expect: 'stops recovery at a checkpoint whose epoch is out of order'
  },
  {
    name: 'a pre-v5 file may carry a peer link',
    file: INDEX,
    from: '      if (schemaVersion < 5 || link === undefined || value.occurredAt !== link.occurredAt) {',
    to: '      if (link === undefined || value.occurredAt !== link.occurredAt) {',
    expect: 'refuses a peer link in a file written before version 5'
  },
  {
    name: 'a peer link may be appended to a pre-v5 mission',
    file: INDEX,
    from: '        if (hydrated.schemaVersion < 5) {',
    to: '        if (hydrated.schemaVersion < 0) {',
    expect: 'refuses to append a peer link to a mission written before version 5'
  },
  {
    name: 'a delivered message is shown to its recipient again',
    file: WORKROOM,
    from: '          (message) => message.to.teammateId === teammateId && !delivered.has(message.messageId)',
    to: '          (message) => message.to.teammateId === teammateId',
    expect: 'shows a message to its recipient once, and never to anyone else'
  },
  {
    name: 'a message is shown to someone it was not addressed to',
    file: WORKROOM,
    from: '          (message) => message.to.teammateId === teammateId && !delivered.has(message.messageId)',
    to: '          (message) => !delivered.has(message.messageId)',
    expect: 'shows a message to its recipient once, and never to anyone else'
  },
  {
    name: 'the reader accepts a self-addressed message',
    file: WORKROOM,
    from: '    || from.teammateId === to.teammateId\n  ) return undefined',
    to: '  ) return undefined',
    expect: 'refuses a self-addressed record on read, not only on write'
  },
  {
    name: 'a second delivery of the same message is written',
    file: WORKROOM,
    from: "            if (delivered.has(messageId)) throw new Error('Workroom message was already delivered')",
    to: '',
    expect: 'refuses to deliver the same message twice'
  },
  {
    name: 'a delivery for a message the file never held is read as valid',
    file: WORKROOM,
    from: '        || !seen.has(delivery.messageId)\n',
    to: '',
    expect: 'refuses a delivery record for a message the file does not hold'
  },
  {
    name: 'the writer appends past a record the reader cannot walk',
    file: WORKROOM,
    from: "    if (parsed.issues.length > 0) throw new Error('Workroom is unavailable')\n    const records = build(parsed)",
    to: '    const records = build(parsed)',
    expect: 'stops at a record that breaks the sequence, and refuses to append past the break'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report FIRST. A vitest run that dies before writing one would
  // otherwise leave the previous run's report in place, and the harness would
  // read a stale green as "this mutation caused no failures" -- a check that
  // cannot go red, inside the tool whose whole job is proving checks can.
  rmSync(REPORT, { force: true })
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter', 'json', '--outputFile', 'mutation-result.json'], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: true
    })
  } catch {
    // A red suite exits non-zero; the report is what we read, not the status.
  }
  if (!existsSync(REPORT)) return { failed: [], unparseable: true, total: -1 }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'))
  const failed = []
  let unparseable = false
  for (const file of report.testResults ?? []) {
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) unparseable = true
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'failed') failed.push(assertion.title)
    }
  }
  return { failed, unparseable, total: report.numTotalTests ?? 0 }
}

const originals = new Map([
  [CHECKPOINT, readFileSync(CHECKPOINT, 'utf8')],
  [INDEX, readFileSync(INDEX, 'utf8')],
  [WORKROOM, readFileSync(WORKROOM, 'utf8')]
])

let problems = 0
try {
  const baseline = runSuite()
  if (baseline.failed.length > 0) {
    console.error(`baseline is not green: ${baseline.failed.join(', ')}`)
    process.exit(1)
  }
  console.error(`baseline green (${baseline.total} tests)\n`)

  for (const mutation of MUTATIONS) {
    const original = originals.get(mutation.file)
    if (!original.includes(mutation.from)) {
      console.error(`  [SKIP] ${mutation.name} -- anchor not found`)
      problems += 1
      continue
    }
    let mutated = original.replace(mutation.from, mutation.to)
    if (mutation.to2 !== undefined) {
      if (!mutated.includes(mutation.to2)) {
        console.error(`  [SKIP] ${mutation.name} -- second anchor not found`)
        problems += 1
        continue
      }
      mutated = mutated.replace(mutation.to2, mutation.replacement2)
    }
    writeFileSync(mutation.file, mutated, 'utf8')
    const result = runSuite()
    writeFileSync(mutation.file, original, 'utf8')

    // Validate the sabotage before believing the red: a mutation that stops the
    // file compiling fails every test and proves nothing about any of them.
    if (result.unparseable || result.total !== baseline.total) {
      console.error(`  [INVALID] ${mutation.name} -- the file stopped running, so this red means nothing`)
      problems += 1
      continue
    }
    const caught = result.failed.includes(mutation.expect)
    if (!caught) problems += 1
    console.error(
      `  [${caught ? 'CAUGHT' : 'SURVIVED'}] ${mutation.name}` +
      (caught ? `\n            failures: ${result.failed.join(', ')}` : `\n            expected "${mutation.expect}" to fail; failures: ${result.failed.join(', ') || 'none'}`)
    )
  }
} finally {
  for (const [file, text] of originals) writeFileSync(file, text, 'utf8')
}

console.error(`\n${problems === 0 ? 'ALL MUTATIONS CAUGHT' : `${problems} MUTATION(S) UNACCOUNTED FOR`}`)
process.exit(problems === 0 ? 0 : 1)
