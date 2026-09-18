// Put the changelog where the people using Locust can read it.
//
//   node _tools/publish-changelog.mjs            publish if it differs
//   node _tools/publish-changelog.mjs --check    say whether it is current, change nothing
//
// CHANGELOG.md is written for someone using Locust rather than reading its
// source, and it lived only in the PRIVATE app repo -- so the one good
// account of what changed was the one nobody outside could open. The public
// side had per-release notes, which is twenty separate pages rather than a
// changelog.
//
// This copies the file into the public releases repo, which is where the
// download, the update feed and the release notes already are, and which the
// site's Changelog link points at. Run it as part of shipping, after the
// release: the version it describes should exist by the time anyone reads it.
//
// Uses `gh api`, so it authenticates the same way every other release step
// does and needs no token of its own.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = 'automatedworkflowllc-design/locust-releases'
const PATH_IN_REPO = 'CHANGELOG.md'
const LOCAL = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))
const checkOnly = process.argv.includes('--check')

const gh = (args, input, quiet = false) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    // The first read of a file that does not exist yet is a 404, which is an
    // answer rather than a fault; printing it makes a clean first publish
    // look like a failure.
    stdio: quiet ? ['pipe', 'pipe', 'ignore'] : ['pipe', 'pipe', 'inherit']
  })

const local = readFileSync(LOCAL, 'utf8')
/** The version the top entry is about, so the report can name it. */
const newest = /^##\s+([0-9]+\.[0-9]+\.[0-9]+)/m.exec(local)?.[1] ?? '(none)'

let published
let sha
try {
  const answer = JSON.parse(gh(['api', `repos/${REPO}/contents/${PATH_IN_REPO}`], undefined, true))
  sha = answer.sha
  published = Buffer.from(answer.content ?? '', 'base64').toString('utf8')
} catch {
  // Not there yet: the first publish creates it.
}

if (published === local) {
  console.log(`CHANGELOG.md on ${REPO} is current (newest entry ${newest}).`)
  process.exit(0)
}

const state = published === undefined ? 'is not published yet' : 'is behind'
if (checkOnly) {
  console.log(`CHANGELOG.md on ${REPO} ${state}. Newest local entry: ${newest}.`)
  // A check that fails loudly is the point: shipping without it leaves the
  // public account of what changed describing an older build.
  process.exit(1)
}

// `gh api` reads the JSON body from stdin with `--input -`, which keeps a
// 244 KB file off the command line entirely -- the same ceiling that bit
// OpenCode's prompt (cmd.exe stops at 8,191 characters).
const body = JSON.stringify({
  message: `Changelog through ${newest}`,
  content: Buffer.from(local, 'utf8').toString('base64'),
  ...(sha === undefined ? {} : { sha })
})
gh(['api', '--method', 'PUT', `repos/${REPO}/contents/${PATH_IN_REPO}`, '--input', '-'], body)
console.log(`Published CHANGELOG.md to ${REPO} (newest entry ${newest}).`)
