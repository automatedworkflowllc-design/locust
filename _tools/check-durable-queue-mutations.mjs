// Behavioral negative controls. Always put the working source back, even on failure.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
const storeTest = 'src/main/a-queued-message-survives-closing-locust.test.ts'
const queueTest = 'src/renderer/src/a-restored-queue-waits-for-send.test.ts'
const uiTest = 'src/renderer/src/a-restored-queue-offers-its-actions.test.tsx'
const mutations = [
  ['Disk replacement omitted', 'src/main/queued-message-store.ts', [['await rename(temporary, path)', 'await unlink(temporary)'], ['await stat(path)', 'void path']], storeTest, 'A fresh reader recovers'],
  ['Restore hold omitted', 'src/renderer/src/steering.ts', [['if (input.restored)', 'if (false)']], queueTest, 'Restored messages wait'],
  ['Saved rows forgotten', 'src/renderer/src/conversationQueue.ts', [["rows = answer.rows.map((row) => ({ ...row, origin: 'person', restored: true }))", 'rows = []']], queueTest, 'Rekeyed messages reopen'],
  ['Write acknowledgement skipped', 'src/renderer/src/conversationQueue.ts', [['const answer = await io.write(', 'rows = after; changed(rows); const answer = await io.write(']], queueTest, 'The UI does not acknowledge|A failed write keeps'],
  ['Rekey omitted', 'src/renderer/src/steering.ts', [['return rows.map((row) => requeuedTo(row, fromKey, toKey) ?? row)', 'return rows']], queueTest, 'Rekeyed messages reopen'],
  ['Restored merge boundary omitted', 'src/renderer/src/steering.ts', [['next.restored !== front.restored || ', '']], queueTest, 'A new automatic queue row'],
  ['Host intents saved', 'src/renderer/src/conversationQueue.ts', [["after.filter((row) => row.origin === 'person')", 'after']], queueTest, 'Only person-written'],
  ['Read failure treated as empty', 'src/renderer/src/conversationQueue.ts', [['if (!readable) return false', 'if (!readable) readable = true']], queueTest, 'An unreadable queue refuses'],
  ['Read error hidden', 'src/renderer/src/components/Composer.tsx', [['{queueError !== undefined && queued === undefined && ', '{false && ']], uiTest, 'A queue read failure'],
  ['Conversation key validation omitted', 'src/shared/queued-messages.ts', [["!/^[A-Za-z0-9_:-]{1,128}$/.test(row.key)", "!/^[A-Za-z0-9_:-]{1,128}$/.test('safe')"]], storeTest, 'Invalid input cannot replace'],
  ['Damaged queue overwritten', 'src/main/queued-message-store.ts', [['await read() // Refuse to overwrite an unreadable file.', '// Unchecked overwrite.']], storeTest, 'A truncated queue|An unknown schema'],
  ['Overlapping Sends allowed', 'src/renderer/src/conversationQueue.ts', [['if (sending) return false', 'if (false) return false']], queueTest, 'Another queued Send waits'],
  ['Refused Send dropped', 'src/renderer/src/conversationQueue.ts', [['if (!sent) await queue.update', 'if (false) await queue.update']], queueTest, 'A refused Send offers'],
  ['Send allowed after failed save', 'src/renderer/src/conversationQueue.ts', [['if (!saved || going === undefined)', 'if (going === undefined)']], queueTest, 'A failed removal write'],
  ['App dispatch bound to another conversation', 'src/renderer/src/App.tsx', [['void sendQueued(shownKey,', "void sendQueued('someone_else',"]], 'src/main/the-box-shows-only-its-own-queue.test.ts', 'The composer sends only']
]
let failed = 0
for (const [name, source, replacements, test, sentence] of mutations) {
  const path = join(desktop, source)
  const original = readFileSync(path, 'utf8')
  let changed = original
  try {
    for (const [from, to] of replacements) {
      if (!changed.includes(from)) throw new Error(`Missing seam: ${from}`)
      changed = changed.replace(from, to)
    }
    writeFileSync(path, changed, 'utf8')
    const run = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', test, '-t', sentence], { cwd: desktop, encoding: 'utf8', timeout: 60_000, windowsHide: true })
    const output = (run.stdout ?? '') + (run.stderr ?? '')
    const caught = run.status !== 0 && /Tests\s+\d+ failed/.test(output) && !/Failed Suites|Transform failed|Cannot find module/.test(output)
    console.log(`[${caught ? 'PASS' : 'FAIL'}] ${name}: ${output.match(/Tests\s+[^\n]+/)?.[0] ?? `exit ${run.status}`}`)
    if (!caught) { failed++; console.log(output.slice(-2000)) }
  } finally { writeFileSync(path, original, 'utf8') }
}
console.log(`MUTATIONS: ${mutations.length - failed}/${mutations.length} caught`)
process.exitCode = failed === 0 ? 0 : 1
