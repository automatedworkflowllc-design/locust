// Every conversation in a COPY of the person's own ledger, opened in the built
// app and read for the words that mean something was hidden or lost (0.585).
//
//   node _tools/sweep-real-threads.mjs --packaged <exe> --out <folder outside the repo> [--limit 60] [--open-steps]
//
// Colin, 2026-10-04: "make sure the outputs are coming out good on all aspects
// across all models, we dont want to hide anything or make the user miss
// anything, full pass". The golden thread test covers the RECORDED runs; this
// reads what the app draws for his real ones, every runtime he used, and
// tallies, per runtime:
//   - an adapter admitting it dropped something ("Unhandled", "could not be
//     parsed", "did not report", "not recorded", "Unknown"),
//   - a drawing fault ("[object Object]", "undefined", "NaN" in the text),
//   - and, for context only, refusals and fresh-session notices.
// Like profile-real-switch.mjs it copies mission-ledger, teammates, folders and
// groups only (never routines, rooms or queued messages, so nothing can start),
// sends nothing, and keeps its report and screenshots in --out, which must be
// outside the repository: they show his conversations.

import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const out = resolve(arg('--out') ?? join(tmpdir(), 'locust-sweep-real-threads'))
const limit = Number(arg('--limit') ?? '60')
const openSteps = process.argv.includes('--open-steps')
if (out.toLowerCase().includes('locust-ship-wt')) throw new Error('--out must be outside the repository: the report shows real conversations')
await mkdir(out, { recursive: true })

const source = join(process.env.APPDATA ?? '', '@teammate', 'desktop')
const profile = await mkdtemp(join(tmpdir(), 'locust-sweep-profile-'))
await cp(join(source, 'mission-ledger'), join(profile, 'mission-ledger'), { recursive: true })
for (const file of ['teammates.json', 'folders.json', 'groups.json']) {
  if (existsSync(join(source, file))) await cp(join(source, file), join(profile, file))
}
const workspace = await mkdtemp(join(tmpdir(), 'locust-sweep-ws-'))
const drive = await startDrive({ name: 'sweep-real-threads', port: 9876, workspace, profilePath: profile, outPath: out, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })

/** What to look for, and whether it counts against the app. */
const WORDS = [
  { key: 'unhandled', re: /\bUnhandled\b/g, counts: true },
  { key: 'could-not-be-parsed', re: /could not be parsed/g, counts: true },
  { key: 'did-not-report', re: /did not report/g, counts: true },
  { key: 'not-recorded', re: /not recorded|was not recorded|cannot show/g, counts: true },
  { key: 'unknown', re: /\bUnknown (?:Antigravity|Codex|Cursor|Copilot|OpenCode|Claude|record|event)\b/g, counts: true },
  { key: 'object-object', re: /\[object Object\]/g, counts: true },
  { key: 'undefined', re: /(?:^|[\s(:])undefined(?:[\s).,]|$)/g, counts: true },
  { key: 'nan', re: /\bNaN\b/g, counts: true },
  { key: 'refused', re: /\brefused\b/g, counts: false },
  { key: 'fresh-session', re: /A fresh session/g, counts: false },
  { key: 'limit', re: /hit its limit|rate limit|usage limit/gi, counts: false }
]

const findings = []
const totals = {}
const tally = (runtime, key, n) => {
  totals[runtime] ??= {}
  totals[runtime][key] = (totals[runtime][key] ?? 0) + n
}
try {
  await drive.ready()
  await drive.resize(1400, 900)
  await sleep(6000)
  const rows = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('button.lc-conv')].map((row, at) => ({ at, title: (row.getAttribute('title') ?? row.innerText).replace(/\\s+/g, ' ').slice(0, 80) })))`)))
  say(`${String(rows.length)} conversations; reading up to ${String(limit)}`)
  for (const row of rows.slice(0, limit)) {
    const read = JSON.parse(String(await drive.evaluate(`(async () => {
      const button = document.querySelectorAll('button.lc-conv')[${String(row.at)}]
      if (!button) return JSON.stringify({ missing: true })
      button.click()
      await new Promise((r) => setTimeout(r, 1400))
      ${openSteps ? "for (const line of document.querySelectorAll('.lc-thread .lc-steps__line[aria-expanded=\"false\"]')) line.click(); await new Promise((r) => setTimeout(r, 500));" : ''}
      // The workroom header names the runtime ("Wren · Code & Migrations · OpenCode"); read it off the text.
      const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 240) ?? ''
      const text = document.querySelector('.lc-thread')?.innerText ?? ''
      return JSON.stringify({ header, runtime: '', text, length: text.length })
    })()`)))
    if (read.missing) continue
    const runtime = (read.runtime || /(Claude Code|Codex CLI|Cursor Agent|OpenCode|Copilot CLI|Antigravity|Muse Code)/.exec(read.header)?.[1] || 'unknown').replace(/\s*·.*$/, '')
    const hits = []
    for (const word of WORDS) {
      const matches = [...read.text.matchAll(word.re)]
      if (matches.length === 0) continue
      tally(runtime, word.key, matches.length)
      if (word.counts) {
        const first = matches[0].index ?? 0
        hits.push({ key: word.key, count: matches.length, around: read.text.slice(Math.max(0, first - 70), first + 90).replace(/\s+/g, ' ') })
      }
    }
    if (hits.length > 0) {
      const picture = await drive.send('Page.captureScreenshot', { format: 'png' })
      const file = `hit-${String(row.at).padStart(3, '0')}.png`
      if (picture?.result?.data) await writeFile(join(out, file), Buffer.from(picture.result.data, 'base64'))
      findings.push({ at: row.at, title: row.title, runtime, hits, picture: file })
      say(`  ${String(row.at).padStart(3)} ${runtime.padEnd(14)} ${hits.map((hit) => `${hit.key}x${String(hit.count)}`).join(' ')}  ${row.title.slice(0, 50)}`)
    }
  }
  const lines = [
    `# Real-thread sweep -- ${new Date().toISOString()}`,
    '',
    `Build: ${packaged ?? 'out/'}. ${String(Math.min(rows.length, limit))} of ${String(rows.length)} conversations read${openSteps ? ', step groups opened' : ''}.`,
    '',
    '## Totals by runtime (key x count)',
    '',
    ...Object.entries(totals).map(([runtime, counts]) => `- ${runtime}: ${Object.entries(counts).map(([key, n]) => `${key} x${String(n)}`).join(', ')}`),
    '',
    `## Conversations with something to look at (${String(findings.length)})`,
    '',
    ...findings.flatMap((finding) => [
      `### ${String(finding.at)} · ${finding.runtime} · ${finding.title}`,
      ...finding.hits.map((hit) => `- **${hit.key}** x${String(hit.count)}: …${hit.around}…`),
      `- picture: ${finding.picture}`,
      ''
    ])
  ]
  await writeFile(join(out, 'REPORT.md'), lines.join('\n'), 'utf8')
  await writeFile(join(out, 'findings.json'), JSON.stringify({ totals, findings }, null, 2), 'utf8')
  say(`report: ${join(out, 'REPORT.md')}`)
} catch (error) {
  say(`sweep failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Every conversation of a copy of the real ledger, read for hidden or lost output. Nothing sent.` })
}
