// Collapse the eight orb-round memories into one named memory.
//
//   node _tools/name-the-orb-memories.mjs            # show what it would do
//   node _tools/name-the-orb-memories.mjs --apply    # do it
//
// Step 1 of MEMORY-MIGRATION-PROPOSAL-2026-09-21.md, and ONLY step 1. The
// six remaining near-duplicate pairs are deliberately left alone: three of
// them carry facts the other does not, and merging them would delete real
// information. See the proposal.
//
// REQUIRES LOCUST 0.242.0 OR NEWER, AND THE APP CLOSED.
//
// A build older than 0.242 does not know the `name` field. Its memory store
// rebuilds every record field by field on read, so the first time that build
// writes memories.json -- any remembered or forgotten line does it -- every
// name written here is silently dropped. The check below refuses rather than
// letting that happen quietly.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PROFILE = join(process.env.APPDATA ?? '', '@teammate', 'desktop')
const MEMORIES = join(PROFILE, 'memories.json')
const NAME = 'orb-round-status'
const apply = process.argv.includes('--apply')

/** The installed build, read from the changelog it shipped with. */
async function installedVersion() {
  const changelog = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Locust', 'resources', 'CHANGELOG.md')
  const text = await readFile(changelog, 'utf8').catch(() => undefined)
  return /^## (\d+\.\d+\.\d+)/m.exec(text ?? '')?.[1]
}

const atLeast = (version, floor) => {
  const a = version.split('.').map(Number)
  const b = floor.split('.').map(Number)
  for (let at = 0; at < 3; at += 1) {
    if ((a[at] ?? 0) !== (b[at] ?? 0)) return (a[at] ?? 0) > (b[at] ?? 0)
  }
  return true
}

const file = JSON.parse(await readFile(MEMORIES, 'utf8'))
const memories = file.memories ?? []

// The cluster, by what it actually is rather than by similarity: a memory
// about an orb ROUND on a specific Locust version, carrying a test count.
const isOrbRound = (memory) =>
  /\borb\b/i.test(memory.text) && /\bround\b/i.test(memory.text) && /unit tests\s*\d+\/\d+/i.test(memory.text)

const rounds = memories.filter(isOrbRound)
rounds.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
const newest = rounds[rounds.length - 1]

console.log(`memories: ${String(memories.length)}`)
console.log(`orb-round memories: ${String(rounds.length)}`)
if (rounds.length < 2) {
  console.log('Nothing to collapse.')
  process.exit(0)
}
console.log(`\nKEEP, renamed "${NAME}":\n  ${newest.text}\n`)
console.log('DROP:')
for (const memory of rounds.slice(0, -1)) console.log(`  ${String(memory.createdAt).slice(0, 10)}  ${memory.text.slice(0, 92)}`)
console.log(`\n${String(memories.length)} -> ${String(memories.length - rounds.length + 1)} memories`)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

const version = await installedVersion()
if (version === undefined) {
  console.error('\nRefusing: could not read the installed Locust version.')
  process.exit(1)
}
if (!atLeast(version, '0.242.0')) {
  console.error(`\nRefusing: Locust ${version} is installed and does not know the \`name\` field.`)
  console.error('It would strip these names the next time it writes memories.json.')
  console.error('Update to 0.242.0 or newer, then run this again.')
  process.exit(1)
}

const kept = new Set(rounds.slice(0, -1).map((memory) => memory.memoryId))
const next = memories
  .filter((memory) => !kept.has(memory.memoryId))
  .map((memory) => (memory.memoryId === newest.memoryId ? { ...memory, name: NAME } : memory))

const backup = `${MEMORIES}.before-${NAME}.json`
await writeFile(backup, JSON.stringify(file, null, 2), 'utf8')
await writeFile(MEMORIES, JSON.stringify({ ...file, memories: next }), 'utf8')
console.log(`\nDone. ${String(next.length)} memories. Backup: ${backup}`)
