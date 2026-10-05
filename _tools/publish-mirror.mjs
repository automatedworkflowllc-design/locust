// Bring the public mirror up to a release (0.584).
//
//   node _tools/publish-mirror.mjs [--from <commit>] [--mirror <folder>] [--deny <file>]
//
// The public copy (automatedworkflowllc-design/locust) was a one-commit
// export of 0.577 while main went on to 0.583; the 1.0 PRD (A5): a mirror is
// only a mirror if it never lags, so this runs after publish-release. It
// exports `--from` (HEAD) with _tools/public-export.mjs -- the exclusions, the
// account-folder scrub and the owner-detail deny list are the export's -- lays
// the tree over a clone of the mirror, commits it as "Locust <version>" by
// "Locust contributors", and pushes. The mirror's own `.github/workflows/` is
// kept: the export leaves workflows out, and the one the public repository
// runs was added there by hand.
//
// Defaults live OUTSIDE every repository, in Documents\Codex\.locust-release:
// `mirror/` (the clone) and `export-deny.txt` (the owner's details, one per
// line -- personal, so never in a repository). No deny file, no mirror: the
// check is part of what makes the copy publishable.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const MIRROR_URL = 'https://github.com/automatedworkflowllc-design/locust.git'
const KEPT_IN_MIRROR = new Set(['.git', '.github'])

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const releaseHome = join(homedir(), 'Documents', 'Codex', '.locust-release')
const from = arg('--from') ?? 'HEAD'
const mirror = resolve(arg('--mirror') ?? join(releaseHome, 'mirror'))
const deny = resolve(arg('--deny') ?? join(releaseHome, 'export-deny.txt'))
const repo = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}\n${result.stdout}${result.stderr}`)
  }
  return result
}

if (!existsSync(deny)) throw new Error(`No deny file at ${deny}: the owner-detail check is part of the mirror. Make it (one term per line) before publishing a mirror.`)
if (mirror.toLowerCase().startsWith(repo.toLowerCase())) throw new Error('--mirror must be outside this repository')

const commit = run('git', ['rev-parse', '--verify', `${from}^{commit}`]).stdout.trim()
const short = commit.slice(0, 8)
const packageJson = JSON.parse(run('git', ['show', `${commit}:apps/desktop/package.json`]).stdout)
const version = String(packageJson.version)
console.log(`Mirror: Locust ${version} from ${short}`)

// 1. The export, with every check the public copy was first made with.
const exported = mkdtempSync(join(tmpdir(), 'locust-mirror-export-'))
const out = join(exported, 'tree')
const exportRun = run(process.execPath, [join(repo, '_tools', 'public-export.mjs'), '--from', commit, '--out', out, '--deny', deny], { allowFailure: true })
const exportLog = `${exportRun.stdout}${exportRun.stderr}`
const summary = exportLog.split('\n').filter((line) => /^(Kept|Deny file|Account folder|Refusing|Scan:|Images still)/.test(line)).join('\n')
console.log(summary)
if (exportRun.status !== 0 || /Refusing to finish/.test(exportLog)) {
  rmSync(exported, { recursive: true, force: true })
  throw new Error('The export refused; the mirror was not touched.')
}

// 2. The mirror clone, at the remote's main.
mkdirSync(releaseHome, { recursive: true })
if (!existsSync(join(mirror, '.git'))) {
  mkdirSync(resolve(mirror, '..'), { recursive: true })
  run('git', ['clone', '-q', MIRROR_URL, mirror])
}
const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: mirror }).stdout.trim()
if (remote !== MIRROR_URL) throw new Error(`${mirror} points at ${remote}, not the mirror`)
run('git', ['fetch', '-q', 'origin'], { cwd: mirror })
run('git', ['checkout', '-q', '-B', 'main', 'origin/main'], { cwd: mirror })
run('git', ['reset', '-q', '--hard', 'origin/main'], { cwd: mirror })

// 3. The tree laid over: everything but the mirror's own .git and .github goes, then the export's files come in (its own .git stays behind).
for (const name of readdirSync(mirror)) {
  if (KEPT_IN_MIRROR.has(name)) continue
  rmSync(join(mirror, name), { recursive: true, force: true })
}
for (const name of readdirSync(out)) {
  if (name === '.git') continue
  if (name === '.github') {
    // The export's .github (templates, no workflows) merges under the mirror's; workflows stay the mirror's own.
    for (const inner of readdirSync(join(out, '.github'))) {
      if (inner === 'workflows') continue
      rmSync(join(mirror, '.github', inner), { recursive: true, force: true })
      cpSync(join(out, '.github', inner), join(mirror, '.github', inner), { recursive: true })
    }
    continue
  }
  cpSync(join(out, name), join(mirror, name), { recursive: true })
}
rmSync(exported, { recursive: true, force: true })

/*
 * A RELEASE ON THE PUBLIC COPY TOO (0.643). Its sidebar said "0 releases"
 * while locust-releases was at 0.641: a copy that looked abandoned. Each
 * export now makes a release there with the version's tag, pointing at the
 * installers, which stay on locust-releases. One already there is left as it
 * is, so a second run of the same export changes nothing.
 */
const RELEASES = 'automatedworkflowllc-design/locust-releases'
function ensurePublicRelease() {
  const repoName = MIRROR_URL.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (run('gh', ['release', 'view', version, '--repo', repoName], { allowFailure: true }).status === 0) {
    console.log(`Release ${version} is already on ${repoName}.`)
    return
  }
  const notes = `Locust ${version}. Installers for Windows and Mac: https://github.com/${RELEASES}/releases/tag/${version}\n\nWhat changed: https://github.com/${RELEASES}/blob/main/CHANGELOG.md`
  run('gh', ['release', 'create', version, '--repo', repoName, '--target', 'main', '--title', `Locust ${version}`, '--notes', notes])
  console.log(`RELEASE MADE: ${version} on ${repoName}`)
}

// 4. Commit and push, as the first export was committed.
run('git', ['add', '-A'], { cwd: mirror })
const staged = run('git', ['diff', '--cached', '--stat'], { cwd: mirror }).stdout.trim()
if (staged.length === 0) {
  console.log('The mirror already matches this release.')
  ensurePublicRelease()
  process.exit(0)
}
console.log(staged.split('\n').at(-1))
const author = { ...process.env, GIT_AUTHOR_NAME: 'Locust contributors', GIT_AUTHOR_EMAIL: 'contributors@locust.local', GIT_COMMITTER_NAME: 'Locust contributors', GIT_COMMITTER_EMAIL: 'contributors@locust.local' }
spawnSync('git', ['commit', '-q', '-m', `Locust ${version}\n\nExported from the private development repository at ${short}.`], { cwd: mirror, env: author, windowsHide: true, stdio: 'inherit' })
run('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: mirror })
const local = run('git', ['rev-parse', 'HEAD'], { cwd: mirror }).stdout.trim()
const published = run('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: mirror }).stdout.split(/\s/)[0]
if (published !== local) throw new Error(`Pushed ${local.slice(0, 8)} but the mirror's main is ${String(published).slice(0, 8)}`)
console.log(`MIRROR PUBLISHED: Locust ${version} at ${local.slice(0, 8)}`)
ensurePublicRelease()
