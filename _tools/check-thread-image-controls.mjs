import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
const renderer = 'src/renderer/src/a-thread-shows-local-pictures.test.tsx'
const requests = 'src/renderer/src/an-image-request-lives-only-with-its-row.test.ts'
const host = 'src/main/an-image-preview-stays-in-its-folder.test.ts'
const run = (file, name) => spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=default', ...(file ? [file, '-t', name] : [renderer, requests, host])], { cwd: desktop, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
function green(label) { const result = run(); if (result.status !== 0) throw Error(`${label}: ${result.stdout}\n${result.stderr}`); console.log(`${label}: 16 tests passed`) }
const activity = 'apps/desktop/src/renderer/src/components/ActivityCard.tsx'
const attached = 'apps/desktop/src/renderer/src/components/AttachedImage.tsx'
const controls = [
  ['Read thumbnail', activity, "fileToolWord(entry.tool ?? '') === 'Read'", 'false', renderer, 'draws an image under each runtime Read row while keeping its name'],
  ['edited thumbnail', activity, "entry.kind === 'unreported' && !entry.failed", "entry.kind === 'unreported' && false && !entry.failed", renderer, 'draws a thumbnail below a changed image file'],
  ['parsed file thumbnail', activity, "entry.kind === 'file' && entry.file.status !== 'DELETED' && <ThreadImage", "entry.kind === 'file' && false && entry.file.status !== 'DELETED' && <ThreadImage", renderer, 'draws an image under a parsed changed-file row but never a deleted file'],
  ['Markdown thumbnail', 'apps/desktop/src/renderer/src/components/ThreadItems.tsx', "if (span.kind === 'image') return <ThreadImage key={`s${String(index)}`} path={span.href} caption={span.text} />", "if (span.kind === 'image') return <span>{span.text}</span>", renderer, 'draws a local Markdown image and uses its alt text as the caption'],
  ['non-image refusal', attached, 'if (isImagePath(path) && read !== undefined)', 'if (read !== undefined)', requests, 'accepts no refused image or failed request and never asks for a non-image'],
  ['host refusal stays quiet', attached, 'if (live && answer.ok) accept(answer)', 'if (live) accept(answer as Extract<WorkspaceImageResponse, { ok: true }>)', requests, 'accepts no refused image or failed request and never asks for a non-image'],
  ['late answer discarded', attached, 'if (live && answer.ok) accept(answer)', 'if (answer.ok) accept(answer)', requests, 'drops an answer that arrives after the row unmounts'],
  ['folder containment', 'apps/desktop/src/main/workspace-image.ts', ['resolve(folder, requested), [folder]', 'insideOnDisk(decision.path, [folder])'], ['resolve(folder, requested), roots', 'insideOnDisk(decision.path, roots)'], host, 'refuses a path outside the conversation even when another allowed root holds it'],
  ['link containment', 'apps/desktop/src/main/workspace-image.ts', '!(await insideOnDisk(decision.path, [folder]))', 'false', host, 'refuses a link that leads outside the conversation'],
  ['image reads keep their rows', 'apps/desktop/src/renderer/src/missionView.ts', ' && !isImagePath(entry.name)', '', renderer, 'keeps image reads out of a folded run of plain tool names'],
  ['picture height bound', 'apps/desktop/src/renderer/src/shell.css', 'max-height: 320px; object-fit: contain', 'max-height: 9999px; object-fit: contain', renderer, 'bounds the picture to the column width and 320 pixels without cropping']
]
green('baseline')
for (const [label, path, from, to, file, name] of controls) {
  const target = join(root, path), before = readFileSync(target, 'utf8')
  let changed = before
  for (const [index, anchor] of (Array.isArray(from) ? from : [from]).entries()) {
    if (!changed.includes(anchor)) throw Error(`Missing anchor: ${label}`)
    changed = changed.replace(anchor, Array.isArray(to) ? to[index] : to)
  }
  try {
    writeFileSync(target, changed)
    const result = run(file, name), output = `${result.stdout}\n${result.stderr}`
    if (result.status === 0 || !output.includes('AssertionError') || !output.includes(name) || !/Tests\s+1 failed/.test(output)) throw Error(`Control did not fail its assertion: ${label}\n${output}`)
    console.log(`CAUGHT: ${label} -- ${name}`)
  } finally { writeFileSync(target, before) }
}
green('restored')
console.log(`${controls.length} controls caught; sources restored`)
