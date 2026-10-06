// Every drive that runs on a packaged build for free, one after another (C6).
//
//   node _tools/sweep-drives.mjs --packaged <exe> --out <dir> [--only a,b] [--from name]
//
// The plan's pre-launch check: "Re-run the whole drive set on a packaged
// build before wave 1". A drive is in the sweep when it takes `--packaged`
// and never asks for a paid account (`spends: true`) -- Colin: free or cheap
// models for my own testing. Each runs alone (ports and the machine's
// attention are shared), on the free model, with a time limit; its record
// goes under <out>/captures (LOCUST_DRIVE_OUT), never into the repository.
//
// What a drive says is read, not judged: its exit code, every line with
// PASS or FAIL in it, and any "failed:" line. The summary is rewritten after
// every drive, so a sweep that is stopped still says what it found.

import { spawn, execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const out = arg('--out')
if (packaged === undefined || out === undefined) {
  console.error('usage: node _tools/sweep-drives.mjs --packaged <exe> --out <dir> [--only a,b] [--from name]')
  process.exit(2)
}
const only = arg('--only')?.split(',').map((name) => name.trim())
const from = arg('--from')
const LIMIT_MS = Number(arg('--limit-min') ?? '20') * 60_000

/**
 * Drives a sweep cannot run as they are, and why -- said in the summary, not
 * dropped (the 0.367 sweep ran both and counted a usage error as a failure).
 */
const SKIP = {
  'drive-context-menu': 'needs --reuse <profile>: it opens a profile another drive made',
  'drive-update-lane': 'needs an OLDER build and --expect-latest / --expect-every: run by hand after a release'
}

/**
 * What one drive needs to reach the thing it tests. The handoff drive picks
 * Cursor while a free run goes on; a drive's window refuses every paid route
 * first unless LOCUST_SPEND=1, so without it the drive guard's refusal is all
 * it ever sees. Cursor is refused before it starts either way: nothing is spent.
 */
const ENV = {
  'drive-handoff-refused': { LOCUST_SPEND: '1' }
}

const tools = new URL('./', import.meta.url).pathname.slice(1)
const drives = readdirSync(tools)
  .filter((name) => /^drive-.*\.mjs$/.test(name) && name !== 'drive-lib.mjs')
  .filter((name) => {
    const text = readFileSync(join(tools, name), 'utf8')
    return text.includes("'--packaged'") && !/spends:\s*true/.test(text)
  })
  .filter((name) => only === undefined || only.includes(name.replace(/\.mjs$/, '')))
  .sort()
const start = from === undefined ? 0 : Math.max(0, drives.findIndex((name) => name.replace(/\.mjs$/, '') === from))

await mkdir(join(out, 'captures'), { recursive: true })
await mkdir(join(out, 'logs'), { recursive: true })
const results = []

/** The whole tree this sweep started, and nothing else: a drive's own app included. */
const killTree = (pid) => new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()))

async function summarise() {
  const lines = results.map((result) => {
    const verdict = result.skipped === true ? 'SKIPPED' : result.timedOut ? 'TIMED OUT' : result.fails > 0 || result.failedLines.length > 0 ? 'FAIL' : result.code !== 0 ? `EXIT ${String(result.code)}` : result.passes > 0 ? 'PASS' : 'RAN'
    return `| ${result.name} | ${verdict} | ${String(result.passes)} | ${String(result.fails)} | ${Math.round(result.ms / 1000)}s | ${result.note.replace(/\|/g, '/').slice(0, 160)} |`
  })
  const md = [
    `# Drive sweep on ${packaged}`,
    '',
    `${String(results.length)} of ${String(drives.length - start)} run.`,
    '',
    '| drive | result | PASS lines | FAIL lines | took | note |',
    '| --- | --- | --- | --- | --- | --- |',
    ...lines,
    ''
  ].join('\n')
  await writeFile(join(out, 'SUMMARY.md'), md, 'utf8')
  await writeFile(join(out, 'summary.json'), JSON.stringify(results, null, 2), 'utf8')
}

for (const name of drives.slice(start)) {
  const began = Date.now()
  const skipped = SKIP[name.replace(/\.mjs$/, '')]
  if (skipped !== undefined) {
    results.push({ name: name.replace(/\.mjs$/, ''), code: 0, timedOut: false, skipped: true, passes: 0, fails: 0, failedLines: [], ms: 0, note: `skipped: ${skipped}` })
    await summarise()
    console.log(`${name}: skipped, ${skipped}`)
    continue
  }
  const child = spawn(process.execPath, [join(tools, name), '--packaged', packaged], {
    cwd: new URL('../', import.meta.url).pathname.slice(1),
    // The free model is the drives' own (drive-lib FREE_ROUTE) unless LOCUST_FREE_MODEL says otherwise. This forced
    // Ling 3.0, and on 2026-10-06 Ling 3.0's provider was down ("Endpoint is unavailable", then rate limits): 41 of
    // the first 83 drives failed on it while Muse Spark answered.
    env: { ...process.env, LOCUST_DRIVE_OUT: join(out, 'captures'), ...(ENV[name.replace(/\.mjs$/, '')] ?? {}) },
    windowsHide: true
  })
  let text = ''
  child.stdout.on('data', (chunk) => { text += String(chunk) })
  child.stderr.on('data', (chunk) => { text += String(chunk) })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void killTree(child.pid)
  }, LIMIT_MS)
  const code = await new Promise((resolve) => child.on('close', (value) => resolve(value ?? -1)))
  clearTimeout(timer)
  await writeFile(join(out, 'logs', name.replace(/\.mjs$/, '.log')), text, 'utf8')
  const lines = text.split(/\r?\n/)
  const passes = lines.filter((line) => /\bPASS\b/.test(line)).length
  const fails = lines.filter((line) => /\bFAIL\b/.test(line)).length
  const failedLines = lines.filter((line) => /(drive|probe) failed:|Error:|TypeError|ReferenceError/.test(line))
  const note = failedLines[0] ?? lines.filter((line) => /\bFAIL\b/.test(line))[0] ?? ''
  results.push({ name: name.replace(/\.mjs$/, ''), code, timedOut, passes, fails, failedLines: failedLines.slice(0, 5), ms: Date.now() - began, note })
  await summarise()
  console.log(`${name}: code ${String(code)}${timedOut ? ' TIMED OUT' : ''}, ${String(passes)} PASS, ${String(fails)} FAIL ${note.slice(0, 120)}`)
}
console.log('SWEEP DONE')
