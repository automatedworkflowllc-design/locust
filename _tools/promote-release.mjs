// Promote one build to the tester lane: the release GitHub calls latest.
//
//   node _tools/promote-release.mjs <version> [--dry-run]
//
// The beta handover, 2026-09-23: "Testers should get at most one new build a
// day." Every build is published as a PRERELEASE (ship.mjs prints how); an
// installed Locust takes only `latest` unless its "every build" switch is on
// (apps/desktop/src/main/update-lane.ts), and the site downloads
// releases/latest. So this, once a day, is what testers get -- and new
// testers install.
//
// It checks the release has everything an update needs (the installer, its
// block map, the stable-name copy, latest.yml), writes a few plain lines on
// what changed since the build testers have now -- from CHANGELOG.md's own
// entry titles, which the 0.304 release body already had the shape of -- and
// then marks it latest. --dry-run prints the lines and changes nothing.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = 'automatedworkflowllc-design/locust-releases'
const version = process.argv[2]
const DRY = process.argv.includes('--dry-run')
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node _tools/promote-release.mjs <version> [--dry-run]')
  process.exit(2)
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })
const compare = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

const release = JSON.parse(gh(['release', 'view', version, '--repo', REPO, '--json', 'tagName,isDraft,isPrerelease,assets']))
if (release.isDraft) throw new Error(`${version} is still a draft: publish it first`)
const names = new Set(release.assets.map((asset) => asset.name))
for (const needed of [`Locust-${version}-setup.exe`, `Locust-${version}-setup.exe.blockmap`, 'Locust-Setup.exe', 'latest.yml']) {
  if (!names.has(needed)) throw new Error(`${version} has no ${needed}: an update to it would fail or be the whole installer`)
}

const current = JSON.parse(gh(['release', 'view', '--repo', REPO, '--json', 'tagName'])).tagName.replace(/^v/, '')
if (compare(version, current) <= 0) throw new Error(`${version} is not newer than the build testers have (${current})`)

// Every changelog entry after the testers' build, up to this one: its bold titles.
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = []
for (const block of changelog.split(/\n(?=## \d)/)) {
  const head = /^## (\d+\.\d+\.\d+)/.exec(block)
  if (head === null) continue
  const entry = head[1]
  if (compare(entry, current) <= 0 || compare(entry, version) > 0) continue
  for (const match of block.matchAll(/^- \*\*(.+?)\*\*/gm)) {
    const title = match[1].replace(/\s+/g, ' ').trim()
    if (!lines.includes(title)) lines.push(title)
  }
}
const notes = [`What changed since ${current}:`, '', ...lines.map((line) => `- ${line}`)].join('\n')
console.log(notes)
if (DRY) process.exit(0)

const file = join(mkdtempSync(join(tmpdir(), 'locust-promote-')), 'notes.md')
writeFileSync(file, notes, 'utf8')
gh(['release', 'edit', version, '--repo', REPO, '--prerelease=false', '--latest', '--notes-file', file])

// The channel, read back: what an installed Locust on the tester lane will now be offered.
for (let attempt = 0; attempt < 10; attempt += 1) {
  const response = await fetch(`https://github.com/${REPO}/releases/latest/download/latest.yml`)
  const shown = (/^version:\s*(\S+)/m.exec(await response.text()) ?? [])[1]
  if (shown === version) {
    console.log(`\nPROMOTED: testers are offered ${version}; the site downloads it.`)
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
}
console.error(`\nMarked latest, but the channel still says something else: check releases/latest.`)
process.exit(1)
