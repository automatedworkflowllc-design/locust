// Keep only the newest N versioned installers in release/.
// electron-builder writes a new ~110MB installer per build and never cleans up;
// 12 days of builds had accumulated 233 of them (24GB).
// Override the count with KEEP_RELEASES=10 pnpm package
import { readdir, stat, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const releaseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'release')
// A count that is not a whole number of at least one is ignored, loudly:
// parseInt('abc') is NaN, slice(NaN) is slice(0), and every installer --
// the one just built included -- was deleted.
const asked = Number.parseInt(process.env.KEEP_RELEASES ?? '3', 10)
const keep = Number.isInteger(asked) && asked >= 1 ? asked : 3
if (keep !== asked) console.warn(`prune-releases: KEEP_RELEASES=${String(process.env.KEEP_RELEASES)} is not a count of at least 1; keeping ${keep}`)
// Unversioned aliases (e.g. Locust-Setup.exe) are what the updater points at - never prune them.
const versioned = /^Locust-\d+\.\d+\.\d+-setup\.exe$/

let entries
try {
  entries = await readdir(releaseDir)
} catch {
  process.exit(0) // nothing built yet
}

const installers = []
for (const name of entries.filter((n) => versioned.test(n))) {
  const path = join(releaseDir, name)
  installers.push({ path, name, mtime: (await stat(path)).mtimeMs })
}

installers.sort((a, b) => b.mtime - a.mtime)
const stale = installers.slice(keep)
// Block maps whose installer is already gone: left by every prune before this
// one, and useless alone -- a differential update needs the installer too.
const orphaned = entries.filter((name) => name.endsWith('-setup.exe.blockmap') && !entries.includes(name.slice(0, -'.blockmap'.length)))
for (const name of orphaned) {
  try {
    await unlink(join(releaseDir, name))
  } catch (err) {
    console.warn(`prune-releases: could not remove ${name}: ${err.message}`)
  }
}
if (orphaned.length > 0) console.log(`prune-releases: removed ${orphaned.length} block map(s) whose installer was gone`)
if (stale.length === 0) {
  console.log(`prune-releases: ${installers.length} installer(s), nothing to prune`)
  process.exit(0)
}

let freed = 0
for (const { path, name } of stale) {
  try {
    freed += (await stat(path)).size
    await unlink(path)
  } catch (err) {
    console.warn(`prune-releases: could not remove ${name}: ${err.message}`)
  }
}
// And each pruned installer's block map, which was never removed. A kept
// installer keeps its own: a differential update needs both.
let maps = 0
for (const { path } of stale) {
  try {
    await unlink(`${path}.blockmap`)
    maps += 1
  } catch {
    // Never had one, or already gone.
  }
}
console.log(
  `prune-releases: removed ${stale.length} installer(s) and ${maps} block map(s), freed ${(freed / 1024 ** 3).toFixed(2)} GB, kept newest ${keep}`,
)
