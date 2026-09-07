// The gate a release has to get through.
//
//   node _tools/ship.mjs                 check everything, package, verify
//   node _tools/ship.mjs --check-only    the gates, no packaging
//   node _tools/ship.mjs --marker "Account default" --marker "Show output"
//
// Written because three releases in one night were cut over a RED typecheck
// gate and nobody noticed. `pnpm typecheck` runs two configs -- node and web
// -- and I had been running one of them plus a third that is not the gate at
// all. Eight errors sat there through 0.38.7, 0.38.8 and 0.38.9, six of them
// dead props left by my own change and two in a test file I wrote.
//
// And because "I verified it" twice meant reading `out/`, which is not what
// anybody installs. The installer carries `app.asar`; that is the artefact,
// and it is what this checks.
//
// The markers are the honest part. A changelog bullet claims something is in
// the app; passing that claim's own words here proves the built artefact
// contains them. Read as UTF-8 -- a latin1 read reported a present string as
// missing twice tonight, because an em-dash is three bytes.

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, statSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')

const args = process.argv.slice(2)
const checkOnly = args.includes('--check-only')
const markers = args.flatMap((arg, index) => (arg === '--marker' ? [args[index + 1] ?? ''] : [])).filter(Boolean)

let failed = 0
const ok = (what) => console.log(`  ok    ${what}`)
const bad = (what, detail) => {
  failed += 1
  console.log(`  FAIL  ${what}`)
  if (detail !== undefined) console.log(`        ${detail}`)
}

const run = (command, argv, label) => {
  const result = spawnSync(command, argv, { cwd: ROOT, shell: true, encoding: 'utf8' })
  if (result.status === 0) {
    ok(label)
    return true
  }
  // A null status on Windows means the shim never ran, which is NOT a pass.
  const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-6)
    .join('\n        ')
  bad(label, `exit ${String(result.status)}\n        ${tail}`)
  return false
}

console.log('\nGates')

// 1. The real gate, both configs, exactly as CI would run it.
run('pnpm', ['typecheck'], 'pnpm typecheck (node AND web configs)')
run('npx', ['vitest', 'run'], 'unit tests')

// 2. A version nobody bumped ships the previous release's bytes under a new
//    name, which is worse than not shipping.
const version = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version
// Releases go to a DIFFERENT repository, so a local tag proves nothing: this
// repo never sees them. Ask the releases repo itself.
const RELEASES_REPO = 'automatedworkflowllc-design/locust-releases'
const published = spawnSync('gh', ['release', 'view', `v${version}`, '--repo', RELEASES_REPO, '--json', 'tagName'], {
  cwd: ROOT,
  shell: true,
  encoding: 'utf8'
})
if (published.status === 0) {
  bad(`version ${version} is not already released`, `v${version} is already published to ${RELEASES_REPO}`)
} else {
  ok(`version ${version} is not published yet`)
}

// 3. A release with no entry is a release nobody can read.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
if (changelog.includes(`## ${version} —`) || changelog.includes(`## ${version} -`)) {
  ok(`CHANGELOG has an entry for ${version}`)
} else {
  bad(`CHANGELOG has an entry for ${version}`, 'add one before shipping')
}

if (failed > 0) {
  console.log(`\n${String(failed)} gate(s) failed. Nothing was packaged.\n`)
  process.exit(1)
}

if (checkOnly) {
  console.log('\nGates pass. --check-only, so nothing was packaged.\n')
  process.exit(0)
}

console.log('\nBuilding and packaging')
if (!run('pnpm', ['build'], 'pnpm build')) process.exit(1)
if (!run('pnpm', ['--filter', '@teammate/desktop', 'package'], 'electron-builder package')) process.exit(1)

console.log('\nWhat actually shipped')

// 4. The artefact, not `out/`. This is the half that was never checked.
const asarPath = join(DESKTOP, 'release', 'win-unpacked', 'resources', 'app.asar')
if (!existsSync(asarPath)) {
  bad('app.asar exists', asarPath)
} else {
  // UTF-8: an em-dash is three bytes and a latin1 read called a present
  // string missing, twice, on 2026-09-07.
  const asar = readFileSync(asarPath).toString('utf8')
  ok(`app.asar is ${String(Math.round(statSync(asarPath).size / 1048576))} MB`)

  const installer = join(DESKTOP, 'release', `Locust-${version}-setup.exe`)
  if (existsSync(installer)) ok(`installer Locust-${version}-setup.exe exists`)
  else bad(`installer Locust-${version}-setup.exe exists`)

  const yml = join(DESKTOP, 'release', 'latest.yml')
  if (existsSync(yml) && readFileSync(yml, 'utf8').includes(`version: ${version}`)) {
    ok(`latest.yml points at ${version}`)
  } else {
    bad(`latest.yml points at ${version}`, 'the update feed would offer the wrong build')
  }

  for (const marker of markers) {
    if (asar.includes(marker)) ok(`shipped: ${JSON.stringify(marker)}`)
    else bad(`shipped: ${JSON.stringify(marker)}`, 'the changelog claims it and the artefact does not have it')
  }
  if (markers.length === 0) {
    console.log('  note  no --marker given; the changelog’s claims were not checked against the artefact')
  }
}

// A copy under a STABLE name, so one link always fetches the newest build.
// locust.lol's download button points at
// `/releases/latest/download/Locust-Setup.exe`. GitHub needs an exact
// filename there, and the versioned installer carries the version in its own,
// so pinning that 404s on the very next release. Uploading this beside it is
// what keeps the button working without anyone remembering to edit a URL --
// and the people it is for do not use GitHub, so a page of assets is not an
// acceptable fallback.
if (failed === 0 && !checkOnly) {
  const installer = join(DESKTOP, 'release', `Locust-${version}-setup.exe`)
  if (existsSync(installer)) {
    copyFileSync(installer, join(DESKTOP, 'release', 'Locust-Setup.exe'))
    ok('stable copy Locust-Setup.exe — upload it beside the versioned one')
  }
}

console.log(
  failed === 0
    ? `\nReady to release ${version}.\n`
    : `\n${String(failed)} check(s) failed AFTER packaging. Do not publish this.\n`
)
process.exit(failed === 0 ? 0 : 1)
