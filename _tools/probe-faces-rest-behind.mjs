// DO THE FACES REST BEHIND OTHER WINDOWS? (0.611)
//
//   node _tools/probe-faces-rest-behind.mjs [--packaged <exe>] [--tag <name>]
//
// Locust's own CPU (this instance's processes, 5 s, Task Manager's measure) with a free-model
// answer streaming: with the window in front, then sent behind other windows (the window's own
// blur, as the app hears it), then back in front. Before 0.611 only the cover rested behind other
// windows; a face beside a run was drawn 30 times a second either way. Spends nothing.

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'dev' : 'packaged')
const OUT = join(recordRoot('faces-rest-behind'), `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-faces-rest-ws-')
const at = '2026-09-10T09:00:00.000Z'
const team = [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: { ...FREE_ROUTE, mode: 'ask' } }]
const drive = await startDrive({
  name: `faces-rest-behind-${tag}`, port: 9880, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
const cpu = (seconds) => {
  const key = drive.profile.replace(/'/g, "''")
  const script = `
$ps = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(Locust|electron)\\.exe$' -and $_.CommandLine -like ('*' + '${key}' + '*') })
$a = @{}; foreach ($p in $ps) { $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($g) { $a[[int]$p.ProcessId] = $g.TotalProcessorTime.TotalMilliseconds } }
Start-Sleep -Seconds ${String(seconds)}
$cores = [Environment]::ProcessorCount
$out = foreach ($p in $ps) { $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($g -and $a.ContainsKey([int]$p.ProcessId)) { $type = 'main'; if ($p.CommandLine -match '--type=([a-z-]+)') { $type = $Matches[1] }; [pscustomobject]@{ type = $type; pct = [Math]::Round((($g.TotalProcessorTime.TotalMilliseconds - $a[[int]$p.ProcessId]) / (${String(seconds)} * 1000)) * 100 / $cores, 1) } } }
@($out) | ConvertTo-Json -Compress`
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
  const rows = raw === '' ? [] : [JSON.parse(raw)].flat()
  const by = {}
  for (const row of rows) by[row.type] = Math.round(((by[row.type] ?? 0) + row.pct) * 10) / 10
  return { total: Math.round(rows.reduce((sum, row) => sum + row.pct, 0) * 10) / 10, gpu: by['gpu-process'] ?? 0, renderer: by.renderer ?? 0, processes: rows.length }
}
const results = []
const measure = async (state) => {
  const running = await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`)
  const row = { state, running, ...cpu(5) }
  results.push(row)
  say(`  ${JSON.stringify(row)}`)
}
const behind = () => drive.evaluate(`window.dispatchEvent(new Event('blur'))`)
const inFront = () => drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
try {
  await drive.ready()
  await drive.resize(1440, 900)
  for (let i = 0; i < 60; i += 1) {
    if (/^\d+ ready$/.test(String(await drive.evaluate(`document.querySelector('.lc-agenthead__note')?.innerText.trim() ?? ''`)))) break
    await sleep(500)
  }
  const sent = String(await drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))
    if (!card) return 'no Wren card'
    card.click()
    await new Promise((r) => setTimeout(r, 800))
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Write about 1,500 words on how locust swarms form and travel, in plain paragraphs, with no headings or lists. Do not use any tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'Send never enabled'
  })()`))
  say(`  ${sent}`)
  for (let i = 0; i < 80; i += 1) {
    if (await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`) === true) break
    await sleep(500)
  }
  await sleep(4000)
  await inFront()
  await measure('streaming, in front')
  await behind()
  await sleep(600)
  await measure('streaming, behind other windows')
  // What holding every CSS animation still behind other windows would add.
  await drive.evaluate(`(() => { const s = document.createElement('style'); s.id = 'probe-pause'; s.textContent = '*, *::before, *::after { animation-play-state: paused !important; }'; document.head.append(s) })()`)
  await sleep(600)
  await measure('streaming, behind, CSS animations held too')
  await drive.evaluate(`document.getElementById('probe-pause')?.remove()`)
  await inFront()
  await sleep(600)
  await measure('streaming, back in front')
} catch (error) {
  say(`  probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'faces-rest-behind.json'), JSON.stringify(results, null, 2))
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Do the faces rest behind other windows?`, extra: JSON.stringify(results, null, 2) })
}
