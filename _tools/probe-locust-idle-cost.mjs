// WHERE LOCUST'S IDLE AND WORKING CPU GOES (2026-10-04).
//
//   node _tools/probe-locust-idle-cost.mjs --packaged <exe>
//
// probe-locust-cpu-by-state.mjs found Home costing 6 % of a 12-core machine with nothing
// happening, and a streaming conversation 14.5 %. This takes each away in turn and measures
// what is left, on this instance's own processes over 5 s (Task Manager's measure):
//   Home: as it is; every CSS animation paused; reduced motion (the faces then draw once and
//   stop, and the stylesheet's own reduced-motion rules apply) -- the floor.
//   A streaming answer (free model): as it is; the "working" sweep paused; every CSS animation
//   paused; as it is again.
// Free model only; it spends nothing.

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('locust-idle-cost'), new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-idle-ws-')
const at = '2026-09-10T09:00:00.000Z'
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: { ...FREE_ROUTE, mode: 'ask' } },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE }
]
const drive = await startDrive({
  name: 'idle-cost', port: 9878, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
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
  return { total: Math.round(rows.reduce((sum, row) => sum + row.pct, 0) * 10) / 10, gpu: by['gpu-process'] ?? 0, renderer: by.renderer ?? 0 }
}
const metrics = async () => Object.fromEntries(((await drive.send('Performance.getMetrics', {}))?.result?.metrics ?? []).map((m) => [m.name, m.value]))
const results = []
const measure = async (state, css) => {
  if (css !== undefined) await drive.evaluate(`(() => { const s = document.createElement('style'); s.id = 'probe-pause'; s.textContent = ${JSON.stringify(css)}; document.head.append(s) })()`)
  await sleep(600)
  const running = await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`)
  const before = await metrics()
  const share = cpu(5)
  const after = await metrics()
  if (css !== undefined) await drive.evaluate(`document.getElementById('probe-pause')?.remove()`)
  const per = (name) => Math.round(((after[name] ?? 0) - (before[name] ?? 0)) / 5 * 10) / 10
  const row = { state, running, total: share.total, gpu: share.gpu, renderer: share.renderer, recalcsPerS: per('RecalcStyleCount'), layoutsPerS: per('LayoutCount'), scriptMsPerS: Math.round(per('ScriptDuration') * 1000) }
  results.push(row)
  say(`  ${JSON.stringify(row)}`)
}
const ALL_PAUSED = '*, *::before, *::after { animation-play-state: paused !important; }'
const SWEEP_PAUSED = '.lc-sweep, .lc-sweep::before, .lc-sweep::after { animation-play-state: paused !important; }'
const home = async () => { await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`); await sleep(2500) }
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.send('Performance.enable', {})
  for (let i = 0; i < 60; i += 1) {
    if (/^\d+ ready$/.test(String(await drive.evaluate(`document.querySelector('.lc-agenthead__note')?.innerText.trim() ?? ''`)))) break
    await sleep(500)
  }
  await sleep(3000)
  await measure('home, as it is')
  await measure('home, CSS animations paused', ALL_PAUSED)
  // Reduced motion: the faces read it when they mount, so leave Home and come back.
  await drive.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await drive.evaluate(`[...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Atlas'))?.click()`)
  await sleep(1500)
  await home()
  await measure('home, reduced motion (faces drawn once)')
  await measure('home, reduced motion and CSS paused (the floor)', ALL_PAUSED)
  await drive.send('Emulation.setEmulatedMedia', { features: [] })
  await drive.evaluate(`[...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Atlas'))?.click()`)
  await sleep(1500)
  await home()
  await measure('home, as it is, again')
  // A long streamed answer on the free model, watched in its conversation.
  const sent = String(await drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))
    if (!card) return 'no Wren card'
    card.click()
    await new Promise((r) => setTimeout(r, 800))
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'no composer'
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Write about 1,500 words on how locust swarms form and travel, in plain paragraphs, with no headings or lists.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'Send never enabled'
  })()`))
  say(`  ${sent}`)
  for (let i = 0; i < 40; i += 1) {
    if ((await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').length`)) > 400) break
    await sleep(500)
  }
  await measure('streaming, as it is')
  await measure('streaming, the working sweep paused', SWEEP_PAUSED)
  await measure('streaming, CSS animations paused', ALL_PAUSED)
  await measure('streaming, as it is, again')
} catch (error) {
  say(`  probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'idle-cost.json'), JSON.stringify(results, null, 2))
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Where Locust's idle and working CPU goes.`, extra: JSON.stringify(results, null, 2) })
}
