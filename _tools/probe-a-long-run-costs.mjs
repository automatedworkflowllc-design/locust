// WHAT A LONG CONVERSATION COSTS WHILE IT RUNS (2026-10-04).
//
//   node _tools/probe-a-long-run-costs.mjs --packaged <exe> --ledger <mission_*.jsonl>
//
// Colin's Locust (0.607) used 30-40 % of a 12-core machine -- GPU process ~27 %, renderer ~15 % --
// while Sonnet's executor ran in it for 99 minutes (2,965 events, a median of 36 a minute), and
// almost nothing once it finished. The cover was not it (it rests behind other windows). This
// opens a COPY of a long conversation's ledger in a throwaway profile and measures this
// instance's own processes over 5 s: open and idle; then a free-model answer streamed into that
// same long conversation (Ask: it cannot change anything); then the same answer streamed into a
// short new conversation. A CPU profile of the renderer is taken while the long one streams.
// The copy lives only in the drive's temporary profile, which finish() deletes. Spends nothing.

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { FREE_ROUTE, FREE_ROW, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const ledgerPath = arg('--ledger')
if (ledgerPath === undefined) throw new Error('--ledger <mission_*.jsonl> is required')
const OUT = join(recordRoot('a-long-run-costs'), new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(OUT, { recursive: true })
const ledgerText = await readFile(ledgerPath, 'utf8')
const missionId = basename(ledgerPath).replace(/\.jsonl$/, '')
const workspace = await scratchRepository('locust-long-run-ws-')
const at = '2026-09-10T09:00:00.000Z'
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: { ...FREE_ROUTE, mode: 'ask' } }
]
const drive = await startDrive({
  name: 'long-run-costs', port: 9879, workspace, outPath: OUT,
  files: { [`mission-ledger/${missionId}.jsonl`]: ledgerText },
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners: { [missionId]: 'tm_wren' }, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

const cpu = (seconds) => {
  const key = drive.profile.replace(/'/g, "''")
  const script = `
$ps = @(Get-CimInstance Win32_Process -Filter "Name='Locust.exe'" | Where-Object { $_.CommandLine -like ('*' + '${key}' + '*') })
$a = @{}; foreach ($p in $ps) { $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($g) { $a[[int]$p.ProcessId] = $g.TotalProcessorTime.TotalMilliseconds } }
Start-Sleep -Seconds ${String(seconds)}
$cores = [Environment]::ProcessorCount
$out = foreach ($p in $ps) { $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($g -and $a.ContainsKey([int]$p.ProcessId)) { $type = 'main'; if ($p.CommandLine -match '--type=([a-z-]+)') { $type = $Matches[1] }; [pscustomobject]@{ type = $type; pct = [Math]::Round((($g.TotalProcessorTime.TotalMilliseconds - $a[[int]$p.ProcessId]) / (${String(seconds)} * 1000)) * 100 / $cores, 1) } } }
@($out) | ConvertTo-Json -Compress`
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
  const rows = raw === '' ? [] : [JSON.parse(raw)].flat()
  const by = {}
  for (const row of rows) by[row.type] = Math.round(((by[row.type] ?? 0) + row.pct) * 10) / 10
  return { total: Math.round(rows.reduce((sum, row) => sum + row.pct, 0) * 10) / 10, gpu: by['gpu-process'] ?? 0, renderer: by.renderer ?? 0, main: by.main ?? 0 }
}
const metrics = async () => Object.fromEntries(((await drive.send('Performance.getMetrics', {}))?.result?.metrics ?? []).map((m) => [m.name, m.value]))
const results = []
const measure = async (state, css) => {
  if (css !== undefined) await drive.evaluate(`(() => { const s = document.createElement('style'); s.id = 'probe-pause'; s.textContent = ${JSON.stringify(css)}; document.head.append(s) })()`)
  await sleep(400)
  const running = await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`)
  const nodes = await drive.evaluate(`document.querySelectorAll('*').length`)
  const before = await metrics()
  const share = cpu(5)
  const after = await metrics()
  if (css !== undefined) await drive.evaluate(`document.getElementById('probe-pause')?.remove()`)
  const per = (name) => Math.round(((after[name] ?? 0) - (before[name] ?? 0)) / 5 * 10) / 10
  const row = { state, running, nodes, ...share, recalcsPerS: per('RecalcStyleCount'), layoutsPerS: per('LayoutCount'), layoutMsPerS: Math.round(per('LayoutDuration') * 1000), styleMsPerS: Math.round(per('RecalcStyleDuration') * 1000), scriptMsPerS: Math.round(per('ScriptDuration') * 1000) }
  results.push(row)
  say(`  ${JSON.stringify(row)}`)
}
/** Sets the open conversation's route to the free model, Ask, from its own chips. */
const freeAsk = async () => String(await drive.evaluate(`(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  control.click()
  let box = null
  for (let i = 0; i < 20 && !box; i += 1) { await new Promise((r) => setTimeout(r, 250)); box = document.querySelector('.lc-picker__input') }
  if (!box) return 'no picker'
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'muse')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  const row = [...document.querySelectorAll('.lc-picker__row')].find((el) => !el.disabled && ${FREE_ROW}.test(el.querySelector('.lc-picker__label')?.textContent ?? ''))
  if (!row) return 'no free row'
  row.click()
  await new Promise((r) => setTimeout(r, 700))
  document.querySelector('button[aria-label="Permission mode"]')?.click()
  await new Promise((r) => setTimeout(r, 400))
  ;[...document.querySelectorAll('[role="menu"][aria-label="Permission mode"] [role="menuitemradio"]')].find((b) => b.querySelector('.lc-menu__name')?.textContent.trim() === 'Ask')?.click()
  await new Promise((r) => setTimeout(r, 400))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() + ' / ' + (document.querySelector('button[aria-label="Permission mode"]')?.innerText.trim() ?? '?')
})()`))
const ask = async (prompt) => String(await drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer'
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(prompt)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); return 'sent' }
  }
  return 'Send never enabled'
})()`))
const waitStreaming = async () => {
  for (let i = 0; i < 80; i += 1) {
    if (await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`) === true) break
    await sleep(500)
  }
  await sleep(4000)
}
const PROMPT = 'Write about 1,500 words on how locust swarms form and travel, in plain paragraphs, with no headings or lists. Do not use any tools.'
const ALL_PAUSED = '*, *::before, *::after { animation-play-state: paused !important; }'
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.send('Performance.enable', {})
  for (let i = 0; i < 60; i += 1) {
    if (/^\d+ ready$/.test(String(await drive.evaluate(`document.querySelector('.lc-agenthead__note')?.innerText.trim() ?? ''`)))) break
    await sleep(500)
  }
  // The long conversation, from the sidebar: it is the only one.
  const opened = String(await drive.evaluate(`(async () => {
    const row = document.querySelector('button.lc-conv')
    if (!row) return 'no conversation row'
    row.click()
    await new Promise((r) => setTimeout(r, 4000))
    return (document.querySelector('.lc-thread')?.innerText.length ?? 0) + ' characters in the thread'
  })()`))
  say(`  opened: ${opened}`)
  await measure('long conversation, open, idle')
  say(`  route: ${await freeAsk()}`)
  say(`  ${await ask(PROMPT)}`)
  await waitStreaming()
  await measure('long conversation, streaming')
  // Where the renderer's time goes while it streams.
  await drive.send('Profiler.enable', {})
  await drive.send('Profiler.setSamplingInterval', { interval: 500 })
  await drive.send('Profiler.start', {})
  await sleep(5000)
  const stopped = await drive.send('Profiler.stop', {})
  const nodes = stopped?.result?.profile?.nodes ?? []
  const self = new Map()
  for (const node of nodes) {
    const frame = node.callFrame ?? {}
    const name = `${frame.functionName || '(anonymous)'} ${String(frame.url ?? '').split('/').pop()}:${String(frame.lineNumber ?? 0)}`
    self.set(name, (self.get(name) ?? 0) + (node.hitCount ?? 0))
  }
  const total = [...self.values()].reduce((sum, n) => sum + n, 0) || 1
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, hits]) => `${Math.round((hits / total) * 1000) / 10}% ${name}`)
  say(`  renderer profile while the long one streams (self time):\n    ${top.join('\n    ')}`)
  await writeFile(join(OUT, 'profile-top.txt'), top.join('\n') + '\n')
  await measure('long conversation, streaming, CSS paused', ALL_PAUSED)
  await measure('long conversation, streaming, again')
  for (let i = 0; i < 240; i += 1) {
    if (await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`) !== true) break
    await sleep(1000)
  }
  // The same answer into a short new conversation.
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  await sleep(1500)
  await drive.evaluate(`[...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))?.click()`)
  await sleep(800)
  say(`  ${await ask(PROMPT)}`)
  await waitStreaming()
  await measure('short conversation, streaming')
  await measure('short conversation, streaming, again')
} catch (error) {
  say(`  probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'long-run-costs.json'), JSON.stringify(results, null, 2))
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. What a long conversation costs while it runs.`, extra: JSON.stringify(results, null, 2) })
}
