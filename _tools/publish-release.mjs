// Publish a built release, and refuse to until every file is really there.
//
//   node _tools/publish-release.mjs <version> --notes "<notes>"
//   node _tools/publish-release.mjs <version> --resume      (a draft already made)
//
// WHY THIS EXISTS (2026-09-24). 0.325.0 was published with no versioned
// installer: its upload stalled, was stopped, and the chain carried on
// because every `gh` in it was piped to `tail -1`, which exits 0 whatever
// came before it. latest.yml pointed every installed Locust at
// Locust-0.325.0-setup.exe, which was not there, and Colin's copy -- restarted
// after twelve hours on 0.314 -- showed "Locust hit a problem ... status 404".
// The same failure on 2026-09-23 for 0.269.0. Drafting first was in the
// recipe; nothing checked the draft before it went out.
//
// So: each upload is its own command with its own exit code, no pipes; the
// release is read back and every file must be on it, uploaded, at the size
// of the file on disk, with latest.yml naming the installer that is there;
// only then is the draft published; and afterwards the installer's own
// download address must answer. A failure at any step leaves a draft, which
// no installed Locust can see.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'automatedworkflowllc-design/locust-releases'
const RELEASE = new URL('../apps/desktop/release/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const version = process.argv[2]
const notesAt = process.argv.indexOf('--notes')
const notes = notesAt === -1 ? undefined : process.argv[notesAt + 1]
const resume = process.argv.includes('--resume')
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version) || (notes === undefined && !resume)) {
  console.error('usage: node _tools/publish-release.mjs <version> --notes "<notes>"   (or --resume for a draft already made)')
  process.exit(2)
}

const say = (line) => console.log(line)
const fail = (line) => {
  console.error(`\nNOT PUBLISHED: ${line}\nThe release is left as a draft; no installed Locust can see it.`)
  process.exit(1)
}
const gh = (args, what) => {
  // No shell: the notes are one argument, spaces and quotes and all, and a
  // shell would split them. gh is an .exe, which needs none to be found.
  const run = spawnSync('gh', args, { cwd: RELEASE, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (run.status !== 0) fail(`${what} failed (exit ${String(run.status)}): ${(run.stderr || run.stdout || '').trim().slice(0, 400)}`)
  return run.stdout
}

const files = [`Locust-${version}-setup.exe.blockmap`, `Locust-${version}-setup.exe`, 'Locust-Setup.exe', 'latest.yml']
const sizes = new Map(files.map((name) => {
  try {
    return [name, statSync(join(RELEASE, name)).size]
  } catch {
    return fail(`${name} is not in ${RELEASE} -- build it with _tools/ship.mjs first`)
  }
}))

// latest.yml must name this version's installer, with the hash of the file
// that is about to be uploaded -- a stale one points the updater elsewhere.
const latest = readFileSync(join(RELEASE, 'latest.yml'), 'utf8')
if (!latest.includes(`version: ${version}`) || !latest.includes(`path: Locust-${version}-setup.exe`)) {
  fail(`latest.yml is not for ${version}:\n${latest}`)
}
const sha512 = createHash('sha512').update(readFileSync(join(RELEASE, `Locust-${version}-setup.exe`))).digest('base64')
if (!latest.includes(`sha512: ${sha512}`)) fail(`latest.yml's sha512 is not the installer on disk`)
say(`${version}: ${files.length} files on disk, latest.yml names the installer and its hash`)

if (!resume) {
  gh(['release', 'create', version, '--repo', REPO, '--draft', '--title', version, '--notes', notes, files[0]], 'creating the draft')
  say('draft created, with the block map')
}
// On a resume, only what the draft does not already hold whole: a 117 MB
// installer is not uploaded twice over a slow line to be sure of it.
const onDraft = resume
  ? JSON.parse(gh(['release', 'view', version, '--repo', REPO, '--json', 'isDraft,assets'], 'reading the draft')).assets
  : []
const whole = (name) => onDraft.some((asset) => asset.name === name && asset.state === 'uploaded' && asset.size === sizes.get(name))
for (const name of resume ? files : files.slice(1)) {
  if (whole(name)) {
    say(`${name} is already on the draft, whole`)
    continue
  }
  say(`uploading ${name} (${(sizes.get(name) / 1024 / 1024).toFixed(1)} MB)...`)
  gh(['release', 'upload', version, name, '--repo', REPO, '--clobber'], `uploading ${name}`)
}

// Read back what the draft actually holds.
const held = JSON.parse(gh(['release', 'view', version, '--repo', REPO, '--json', 'isDraft,assets'], 'reading the draft back'))
for (const name of files) {
  const asset = held.assets.find((entry) => entry.name === name)
  if (asset === undefined) fail(`${name} is not on the release`)
  if (asset.state !== 'uploaded') fail(`${name} is on the release but ${String(asset.state)}`)
  if (asset.size !== sizes.get(name)) fail(`${name} is ${String(asset.size)} bytes on the release and ${String(sizes.get(name))} on disk`)
}
say(`all ${String(files.length)} files are on the draft, uploaded, at their sizes on disk`)

gh(['release', 'edit', version, '--repo', REPO, '--draft=false', '--latest'], 'publishing')
say(`published ${version} as latest`)

// And what an installed Locust will do next: find the tag, then fetch the installer.
const tag = spawnSync('curl', ['-sL', '--max-time', '60', '-H', 'Accept: application/json', `https://github.com/${REPO}/releases/latest`], { encoding: 'utf8' })
const latestTag = (() => { try { return JSON.parse(tag.stdout).tag_name } catch { return undefined } })()
const installer = spawnSync('curl', ['-sL', '--max-time', '120', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-r', '0-1023', '-w', '%{http_code}', `https://github.com/${REPO}/releases/download/${version}/Locust-${version}-setup.exe`], { encoding: 'utf8' })
say(`latest tag: ${String(latestTag)} · installer answers: ${installer.stdout}`)
if (latestTag !== version || !/^20[06]$/.test(installer.stdout.trim())) {
  console.error(`\nPUBLISHED, BUT CHECK IT: the latest tag or the installer download did not answer as expected. Pull it back with: gh release edit ${version} --repo ${REPO} --draft=true`)
  process.exit(1)
}
say('\nPUBLISHED AND ANSWERING')
