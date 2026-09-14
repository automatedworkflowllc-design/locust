// Keep only the newest N versioned installers in release/.
// electron-builder writes a new ~110MB installer per build and never cleans up;
// 12 days of builds had accumulated 233 of them (24GB).
// Override the count with KEEP_RELEASES=10 pnpm package
import { readdir, stat, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const releaseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'release')
const keep = Number.parseInt(process.env.KEEP_RELEASES ?? '3', 10)
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
console.log(
  `prune-releases: removed ${stale.length} installer(s), freed ${(freed / 1024 ** 3).toFixed(2)} GB, kept newest ${keep}`,
)
