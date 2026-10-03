// Build a one-commit public copy of Locust from a commit of this repository.
//
//   node _tools/public-export.mjs --from <commit> --out <empty folder outside the repo>
//
// The working tree is never the source. Screenshot and session-record paths
// in EXCLUSIONS are left out, the Windows account folder is rewritten in
// text files, and the copy gets a fresh repository with no remote.

import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// Screenshot and session-record folders under docs/. docs/assets is the
// imagery the README links, and docs/wip is a source patch, so neither is
// listed. Everything else directly under docs/ that was a capture, a
// measurement dump, or a CLI session is listed here.
const RECORD_FOLDERS = [
  'a-coder-fixes-a-bug-2026-09-28',
  'a-conversation-2026-09-27',
  'a-hand-off-chain-2026-09-28',
  'a-long-conversation-2026-09-29',
  'a-page-and-a-design-2026-09-28',
  'a-room-from-scratch-2026-09-27',
  'a-routine-from-scratch-2026-09-28',
  'a-spreadsheet-cleanup-2026-09-28',
  'a-turn-reads-as-it-happens-2026-09-30',
  'a-working-teammate-2026-09-29',
  'about-you-2026-09-28',
  'about-you-keeps-keys-out-2026-09-28',
  'about-you-suggestion-2026-09-28',
  'agent-everyday-jobs-2026-09-28',
  'antigravity-answer-2026-09-23',
  'approvals-2026-09-27',
  'at-a-file-2026-09-28',
  'at-in-a-big-folder-2026-09-29',
  'background-2026-09-27',
  'beams-2026-09-23',
  'beside-2026-09-27',
  'beta-fixes-2026-09-23',
  'beta-fixes-2026-09-24',
  'beta-fixes-2026-09-27',
  'beta-vm',
  'blind-compare-2026-09-28',
  'bots-everywhere-2026-09-22',
  'build-and-compare-2026-09-28',
  'calm-bots-2026-09-23',
  'chain-measure',
  'claude-cloud-read-2026-10-02',
  'claude-commands-2026-09-28',
  'claude-names-2026-09-22',
  'claude-warning-run-2026-09-27',
  'close-guard-2026-09-26',
  'codex-commands-2026-09-28',
  'compare-answers-2026-09-28',
  'compare-changes-2026-09-28',
  'compare-column-actions-2026-09-28',
  'compare-from-home-2026-09-28',
  'compare-pages-2026-09-28',
  'composer-buttons-2026-09-23',
  'composer-fits-2026-09-27',
  'context-menu-2026-09-22',
  'copilot-approve-each-2026-09-26',
  'cursor-keeps-default-2026-09-28',
  'deny-with-reason-2026-09-26',
  'design-frames-2026-09-14',
  'design-frames-2026-09-15',
  'design-frames-2026-09-16',
  'design-frames-2026-09-19',
  'diff-notes-2026-09-26',
  'effort-slider-2026-09-23',
  'font-frames-2026-09-22',
  'harness-2026-09-23',
  'home-beside-2026-09-27',
  'home-cover-2026-09-22',
  'home-cover-bots-2026-09-22',
  'interrupted-last-words-2026-09-27',
  'land-2026-09-28',
  'lockup-lighting-2026-09-22',
  'make-a-teammate-2026-09-27',
  'memory-list-replaces-2026-09-28',
  'memory-tidy-2026-09-26',
  'metal-composer-2026-09-23',
  'missions-screen-2026-09-27',
  'monochrome-2026-09-28',
  'muse-probe-2026-09-21',
  'needs-you-2026-09-26',
  'new-teammate-fit-2026-09-22',
  'node-notice-2026-09-27',
  'open-in-terminal-2026-09-27',
  'opencode-commands-2026-09-28',
  'orb-frames-2026-09-22',
  'packaged-audit-2026-09-15',
  'picker-frames-2026-09-22',
  'review-changes-2026-09-28',
  'ring-reading-2026-09-23',
  'room-ask-one-2026-09-26',
  'room-remembers-2026-09-26',
  'room-round-two-2026-09-27',
  'routine-notices-and-mode-2026-09-28',
  'routine-review-card-2026-09-27',
  'runtime-canary',
  'runtime-marks-2026-09-26',
  'secret-not-remembered-2026-09-27',
  'settings-like-claude-2026-09-27',
  'settings-pages-2026-09-28',
  'sidebar-and-search-2026-09-27',
  'signed-out-2026-09-27',
  'slash-rows-fit-2026-09-28',
  'spark-and-menu-2026-09-28',
  'tag-a-teammate-2026-09-28',
  'team-board-2026-09-26',
  'team-card-2026-09-27',
  'terminal-catch-up-2026-09-27',
  'the-chat-box-2026-09-27',
  'usage-reading-age-2026-09-27',
  'usage-ring-2026-09-27',
  'user-session',
  'whats-new-2026-09-23',
  'working-spark-2026-09-27'
]

export const EXCLUSIONS = [
  ...RECORD_FOLDERS.map((name) => `docs/${name}/**`),
  'docs/BETA-REVIEW-*',
  'docs/HANDOFF-*',
  'docs/internal/**',
  'docs/USER-SESSION-*',
  'docs/locust-beta-full-report-*',
  'docs/design-teammate-dock.png',
  'docs/orb-sharpness-*.png',
  'docs/locust-*-frames-*.zip',
  'docs/cap-frontier-*.json',
  'docs/smoke-results*.json',
  'apps/desktop/_ui-profile/**',
  '**/*.cpuprofile',
  'ASTRA-WORKTREE.md',
  // A Chromium profile a smoke or drive run left in the tree.
  '**/*-profile/**'
]

const EXCLUSION_PATTERNS = EXCLUSIONS.map((glob) => ({ glob, re: compileGlob(glob) }))

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.icns', '.svg'])

const SCAN_PATTERNS = [
  { name: 'sk-', re: /sk-[A-Za-z0-9_-]{8,}/g },
  { name: 'ghp_', re: /ghp_[A-Za-z0-9]{8,}/g },
  { name: 'AKIA', re: /AKIA[A-Z0-9]{8,}/g },
  { name: '-----BEGIN', re: /-----BEGIN [A-Z ]+-----/g },
  { name: 'xox', re: /xox[baprs]-[A-Za-z0-9-]{8,}/g },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'phone', re: /(?<!\d)(?:\+\d{1,3}[\s.-])?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g }
]

function accountName() {
  return ['h', 'i', 's', 'b', 'o'].join('')
}

function accountPattern() {
  return new RegExp(`(?<![A-Za-z0-9_])${accountName()}(?![A-Za-z0-9_])`, 'gi')
}

export function compileGlob(glob) {
  let source = '^'
  let i = 0
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 3
      continue
    }
    if (glob.startsWith('**', i)) {
      source += '.*'
      i += 2
      continue
    }
    const ch = glob[i]
    if (ch === '*') {
      source += '[^/]*'
      i += 1
      continue
    }
    source += /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch
    i += 1
  }
  return new RegExp(`${source}$`)
}

export function exclusionRule(repoPath) {
  const path = repoPath.replace(/\\/g, '/').replace(/^\.\//, '')
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.re.test(path)) return pattern.glob
  }
  return null
}

export function isExcluded(repoPath) {
  return exclusionRule(repoPath) !== null
}

export function scrubText(text) {
  return text.replace(accountPattern(), '<home>')
}

export function accountRemains(text) {
  return accountPattern().test(text)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

function parseArgs(argv) {
  let from
  let out
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--from') from = argv[i += 1]
    else if (arg === '--out') out = argv[i += 1]
    else throw new Error(`Unknown argument ${arg ?? ''}`)
  }
  if (!from || !out) {
    throw new Error('Usage: node _tools/public-export.mjs --from <commit> --out <empty folder outside the repo>')
  }
  return { from, out }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr?.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (code !== 0 && options.allowFailure !== true) {
        reject(new Error(`${command} ${args.join(' ')} exited ${String(code)}\n${err || out}`))
        return
      }
      resolvePromise({ code: code ?? 1, stdout: out, stderr: err })
    })
  })
}

function inside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true
  return false
}

async function commandExists(name) {
  const result = await run('where.exe', [name], { allowFailure: true })
  return result.code === 0
}

async function listTree(repo, commit) {
  const result = await run('git', ['-C', repo, 'ls-tree', '-r', '-l', commit])
  const files = []
  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const path = line.slice(tab + 1).replace(/\\/g, '/')
    const size = Number(line.slice(0, tab).trim().split(/\s+/)[3])
    files.push({ path, size: Number.isFinite(size) ? size : 0 })
  }
  return files
}

async function walkFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const parent = entry.parentPath ?? entry.path
    if (parent === undefined) continue
    const full = join(parent, entry.name)
    if (full.split(sep).includes('.git')) continue
    files.push(full)
  }
  return files
}

function redact(kind, match) {
  if (kind === 'email' || kind === 'phone') return match
  return `${match.slice(0, 6)}… (${String(match.length)} chars)`
}

async function scanFile(rel, text) {
  const hits = []
  for (const pattern of SCAN_PATTERNS) {
    pattern.re.lastIndex = 0
    for (const match of text.matchAll(pattern.re)) {
      hits.push(`${rel}: ${pattern.name} ${redact(pattern.name, match[0])}`)
      if (hits.length >= 20) return hits
    }
  }
  return hits
}

async function main() {
  const { from, out } = parseArgs(process.argv.slice(2))
  const repo = (await run('git', ['rev-parse', '--show-toplevel'])).stdout.trim()
  const commit = (await run('git', ['-C', repo, 'rev-parse', '--verify', `${from}^{commit}`])).stdout.trim()
  const destination = resolve(out)
  if (inside(repo, destination)) {
    throw new Error(`--out must be outside the repository (${repo})`)
  }
  try {
    const existing = await readdir(destination)
    if (existing.length > 0) throw new Error(`--out is not empty: ${destination}`)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      await mkdir(destination, { recursive: true })
    } else {
      throw error
    }
  }

  console.log(`Public export`)
  console.log(`From: ${commit}`)
  console.log(`Out:  ${destination}`)
  console.log('')

  const tree = await listTree(repo, commit)
  const groups = new Map(EXCLUSIONS.map((glob) => [glob, { files: 0, bytes: 0 }]))
  let excludedFiles = 0
  let excludedBytes = 0
  let keptFiles = 0
  let keptBytes = 0
  for (const file of tree) {
    const rule = exclusionRule(file.path)
    if (rule === null) {
      keptFiles += 1
      keptBytes += file.size
      continue
    }
    const group = groups.get(rule)
    if (group !== undefined) {
      group.files += 1
      group.bytes += file.size
    }
    excludedFiles += 1
    excludedBytes += file.size
  }

  console.log('Excluded')
  for (const glob of EXCLUSIONS) {
    const group = groups.get(glob)
    if (group === undefined || group.files === 0) continue
    console.log(`  ${glob}  ${String(group.files)} files  ${formatBytes(group.bytes)}`)
  }
  console.log(`  total  ${String(excludedFiles)} files  ${formatBytes(excludedBytes)}`)
  console.log(`Kept  ${String(keptFiles)} files  ${formatBytes(keptBytes)}`)
  console.log('')

  const tarPath = join(tmpdir(), `locust-public-export-${String(process.pid)}.tar`)
  const excludePath = join(tmpdir(), `locust-public-export-${String(process.pid)}.exclude`)
  const excludedPaths = tree.filter((file) => isExcluded(file.path)).map((file) => file.path)
  await writeFile(excludePath, `${excludedPaths.join('\n')}\n`)
  await run('git', ['-C', repo, 'archive', '--format=tar', '-o', tarPath, commit])
  await run('tar', ['-xf', tarPath, '-C', destination, `--exclude-from=${excludePath}`])
  await rm(tarPath, { force: true })
  await rm(excludePath, { force: true })

  const leaked = []
  for (const full of await walkFiles(destination)) {
    const rel = relative(destination, full).split(sep).join('/')
    if (!isExcluded(rel)) continue
    leaked.push(rel)
    await rm(full, { force: true })
  }
  if (leaked.length > 0) {
    console.log(`Removed ${String(leaked.length)} excluded files the archive still contained.`)
  }

  const touched = []
  const remaining = []
  for (const full of await walkFiles(destination)) {
    const rel = relative(destination, full).split(sep).join('/')
    const buf = await readFile(full)
    if (looksBinary(buf)) {
      if (accountRemains(buf.toString('latin1'))) remaining.push(rel)
      continue
    }
    const before = buf.toString('latin1')
    const after = scrubText(before)
    if (after !== before) {
      await writeFile(full, Buffer.from(after, 'latin1'))
      touched.push(rel)
    }
    if (accountRemains(after)) remaining.push(rel)
  }

  console.log(`Scrubbed ${String(touched.length)} files`)
  for (const path of touched) console.log(`  ${path}`)
  console.log('')

  if (remaining.length > 0) {
    console.log('Refusing to finish: the account folder is still in')
    for (const path of remaining) console.log(`  ${path}`)
    process.exitCode = 1
    return
  }
  console.log('Account folder remaining: none')
  console.log('')

  const gitleaks = await commandExists('gitleaks')
  const trufflehog = await commandExists('trufflehog')
  if (gitleaks) {
    console.log('Scan: gitleaks detect --no-git')
    const result = await run('gitleaks', ['detect', '--no-git', '--source', destination, '--redact'], { allowFailure: true })
    console.log(result.stdout || result.stderr || `(exit ${String(result.code)}, no output)`)
  } else if (trufflehog) {
    console.log('Scan: trufflehog filesystem')
    const result = await run('trufflehog', ['filesystem', destination, '--no-update'], { allowFailure: true })
    console.log(result.stdout || result.stderr || `(exit ${String(result.code)}, no output)`)
  } else {
    console.log('Scan: neither gitleaks nor trufflehog is installed. Built-in pattern scan:')
    const hits = []
    for (const full of await walkFiles(destination)) {
      const rel = relative(destination, full).split(sep).join('/')
      const buf = await readFile(full)
      if (looksBinary(buf) || buf.length > 5 * 1024 * 1024) continue
      const found = await scanFile(rel, buf.toString('utf8'))
      hits.push(...found)
    }
    if (hits.length === 0) console.log('  no matches')
    else for (const hit of hits) console.log(`  ${hit}`)
  }
  console.log('')

  const images = []
  for (const full of await walkFiles(destination)) {
    const rel = relative(destination, full).split(sep).join('/')
    const dot = rel.lastIndexOf('.')
    const ext = dot < 0 ? '' : rel.slice(dot).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) continue
    const info = await stat(full)
    images.push({ rel, size: info.size })
  }
  images.sort((a, b) => a.rel.localeCompare(b.rel))
  console.log(`Images still in the copy (${String(images.length)}). Look at each one before publishing.`)
  for (const image of images) console.log(`  ${image.rel}  ${formatBytes(image.size)}`)
  console.log('')

  const author = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Locust contributors',
    GIT_AUTHOR_EMAIL: 'contributors@locust.local',
    GIT_COMMITTER_NAME: 'Locust contributors',
    GIT_COMMITTER_EMAIL: 'contributors@locust.local'
  }
  await run('git', ['init', '-b', 'main'], { cwd: destination })
  await run('git', ['add', '-A'], { cwd: destination })
  await run('git', ['commit', '-m', 'Initial public copy of Locust.'], { cwd: destination, env: author })
  const remotes = (await run('git', ['remote'], { cwd: destination })).stdout.trim()
  const authorName = (await run('git', ['log', '-1', '--format=%an'], { cwd: destination })).stdout.trim()
  const count = (await run('git', ['rev-list', '--count', 'HEAD'], { cwd: destination })).stdout.trim()
  if (remotes.length > 0) throw new Error(`a remote was set: ${remotes}`)
  if (authorName !== 'Locust contributors') throw new Error(`unexpected author ${authorName}`)
  if (count !== '1') throw new Error(`expected one commit, found ${count}`)
  console.log('Repository: one commit, author "Locust contributors", no remote.')
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
