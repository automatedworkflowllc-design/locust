// HOW MUCH CPU LOCUST ITSELF TAKES, BY SCREEN AND STATE (2026-10-04).
//
//   node _tools/probe-locust-cpu-by-state.mjs --packaged <exe>
//
// Colin's Task Manager, while Sonnet's executor ran: Locust (11) at 32-41 % of a 12-core
// machine, its GPU process ~27 % and renderer ~15 % by a 5-second sample -- for an app showing
// one run. Is that the app, and in which state? This measures this instance's own processes
// (matched by its profile folder) over 5 s in four states -- Home idle, Home while a teammate
// works, the conversation while it streams, both idle after -- with the renderer's own counts
// (CDP Performance: style recalcs, layouts, script and task time) and the animations running.
// Free model only (a streamed answer, no commands): it spends nothing.

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('locust-cpu-by-state'), new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-cpu-ws-')
const at = '2026-09-10T09:00:00.000Z'
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: { ...FREE_ROUTE, mode: 'ask' } },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE }
]
const drive = await startDrive({
  name: 'cpu-by-state', port: 9877, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

/** This instance's processes' CPU over `seconds`, as a share of the whole machine (Task Manager's measure). */
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
  return { total: Math.round(rows.reduce((sum, row) => sum + row.pct, 0) * 10) / 10, by }
}
const metrics = async () => {
  const answer = await drive.send('Performance.getMetrics', {})
  return Object.fromEntries((answer?.result?.metrics ?? []).map((m) => [m.name, m.value]))
}
const results = []
const measure = async (state) => {
  const running = await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]')) || [...document.querySelectorAll('.lc-hometeam__state')].some((s) => /working|thinking|replying/i.test(s.innerText))`)
  const animations = JSON.parse(String(await drive.evaluate(`JSON.stringify(document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a.animationName ?? a.constructor.name) + ' @ ' + String(a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? a.effect?.target?.tagName ?? '').slice(0, 50)))`)))
  const before = await metrics()
  const share = cpu(5)
  const after = await metrics()
  const per = (name) => Math.round(((after[name] ?? 0) - (before[name] ?? 0)) / 5 * 10) / 10
  const row = {
    state, running, cpu: share,
    perSecond: { styleRecalcs: per('RecalcStyleCount'), layouts: per('LayoutCount'), scriptMs: Math.round(per('ScriptDuration') * 1000), taskMs: Math.round(per('TaskDuration') * 1000) },
    animations: animations.length, animationNames: [...new Set(animations)].slice(0, 12)
  }
  results.push(row)
  say(`  ${state}: ${JSON.stringify(row)}`)
}
const cards = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-hometeam__card')].map((card) => ({ name: card.querySelector('.lc-hometeam__name')?.firstChild?.textContent?.trim() ?? '', word: card.querySelector('.lc-hometeam__state')?.innerText.trim() ?? null })))`)))
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.send('Performance.enable', {})
  for (let i = 0; i < 60; i += 1) {
    if (/^\d+ ready$/.test(String(await drive.evaluate(`document.querySelector('.lc-agenthead__note')?.innerText.trim() ?? ''`)))) break
    await sleep(500)
  }
  await sleep(3000)
  await measure('home, idle')
  const sent = String(await drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))
    if (!card) return 'no Wren card'
    card.click()
    await new Promise((r) => setTimeout(r, 800))
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'no composer'
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Write about 900 words on how locust swarms form, in plain paragraphs, with no headings.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'Send never enabled'
  })()`))
  say(`  ${sent}`)
  await sleep(1500)
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    if ((await cards()).some((card) => /working|thinking|replying/i.test(card.word ?? ''))) break
  }
  await measure('home, a teammate working')
  await drive.evaluate(`[...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))?.click()`)
  await sleep(1200)
  await measure('the conversation, streaming')
  for (let i = 0; i < 240; i += 1) {
    if (await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`) !== true) break
    await sleep(1000)
  }
  await sleep(3000)
  await measure('the conversation, idle after')
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  await sleep(3000)
  await measure('home, idle after')
} catch (error) {
  say(`  probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'cpu-by-state.json'), JSON.stringify(results, null, 2))
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Locust's own CPU by state.`, extra: JSON.stringify(results, null, 2) })
}
