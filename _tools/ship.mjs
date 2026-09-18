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

// 2b. An installer is built from the WORKING TREE, not from a commit.
//
//     On 2026-09-08 two agents were editing this checkout at once, and for
//     about forty-five minutes any release would have packaged the other's
//     half-finished feature -- typechecking, passing its own tests, and
//     completely unintended. The gates above cannot catch that: uncommitted
//     work can be perfectly green and still be nobody's idea of a release.
//
//     So a release is cut from a tree with nothing outstanding in it. That is
//     also what makes `git log` an honest record of what any given installer
//     contains, which it silently was not before.
//
//     Untracked files under `docs/user-session/` are the one exception: drives
//     write their records there constantly, they ship nothing, and requiring a
//     commit for every screenshot would make this gate something to route
//     around rather than obey.
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, shell: true, encoding: 'utf8' })
if (dirty.status !== 0) {
  // Not a git repository, or git is unavailable. Say so rather than passing a
  // check that was never actually made.
  bad('the working tree is clean', 'git status could not be read, so this was not checked')
} else {
  const outstanding = (dirty.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^\?\? docs\/user-session\//.test(line))
  if (outstanding.length === 0) {
    ok('the working tree is clean')
  } else {
    bad(
      'the working tree is clean',
      `${String(outstanding.length)} uncommitted change(s) would be built into this installer:\n        ${outstanding.slice(0, 6).join('\n        ')}`
    )
  }
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
// npm, staged where the packager will carry it, so a machine with no Node.js
// can still install a coding CLI. It refuses rather than staging a half copy,
// which is the failure that would otherwise reach a person as a broken
// button instead of an honest "you need Node".
if (!run('node', ['_tools/vendor-npm.mjs'], 'stage the npm this app ships')) process.exit(1)
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

  /*
   * The files BESIDE the archive, not just inside it.
   *
   * `extraResources` are laid down next to app.asar because something has
   * to open them as real files: the window icon, and since 0.63.0 the
   * permission bridge that Claude Code spawns as a process. A missing one
   * fails silently in the installed app -- the icon falls back to Electron's
   * emblem, the bridge never starts and every connector call is refused --
   * and nothing in the asar check would notice, because they are not in it.
   * Read from the builder config so a new entry is checked without anybody
   * remembering to add it here.
   */
  const builderConfig = readFileSync(join(DESKTOP, 'electron-builder.yml'), 'utf8')
  const extra = [...builderConfig.matchAll(/^\s*-\s*from:\s*(\S+)\s+to:\s*(\S+)/gm)]
  for (const [, from, to] of extra) {
    const shipped = join(DESKTOP, 'release', 'win-unpacked', 'resources', to)
    const source = join(DESKTOP, from)
    if (!existsSync(shipped)) {
      bad(`beside the asar: ${to}`, 'named in extraResources and not laid down')
    } else if (!existsSync(source) || !readFileSync(shipped).equals(readFileSync(source))) {
      bad(`beside the asar: ${to}`, 'differs from its source')
    } else {
      ok(`beside the asar: ${to}`)
    }
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

/*
 * The two steps that come AFTER the release, spelled out here because this is
 * the last thing anyone reads before doing them.
 *
 * `publish-changelog` is the one that is easy to forget and invisible when
 * forgotten: the app and the site both point at the public CHANGELOG.md, and
 * a release without it leaves both describing the previous build. Uploading
 * the installers one at a time is not fussiness either -- a single
 * `gh release create` carrying both stalled for fifty minutes on 2026-09-17
 * and had to be killed, where one asset per call went through immediately.
 */
console.log(
  failed === 0
    ? `\nReady to release ${version}.\n\n`
      + `  gh release create ${version} --repo automatedworkflowllc-design/locust-releases \\\n`
      + `    --title ${version} --notes "..." latest.yml\n`
      + `  gh release upload ${version} Locust-${version}-setup.exe --repo ... --clobber\n`
      + `  gh release upload ${version} Locust-Setup.exe --repo ... --clobber\n`
      + `  node _tools/publish-changelog.mjs      # the app and the site both read this\n`
      + `  node _smoke/update-smoke.mjs\n`
    : `\n${String(failed)} check(s) failed AFTER packaging. Do not publish this.\n`
)
process.exit(failed === 0 ? 0 : 1)
