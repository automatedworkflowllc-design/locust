// No AI-agent turns. Real pinned download, fake local mic, editable transcript.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startDrive, scratchRepository, sleep } from './drive-lib.mjs'

const workspace = await scratchRepository('voice-workspace-')
const profile = await mkdtemp(join(tmpdir(), 'voice-profile-'))
const clip = resolve('_tools/voice-spike/results/clip.wav')
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const drive = await startDrive({ name: 'voice-dictation', port: 9896, workspace, profilePath: profile, keep: true, ...(packaged === undefined ? {} : { packaged }),
  sendsNothing: true, focused: true,
  extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${clip}`],
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_voice', name: 'Voice', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-10-06T00:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off' } }
})
const checks = []
const measurements = {}
const check = (name, condition, detail) => {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` (${String(detail)})`}`)
  assert.ok(condition, name)
}
const wait = async (expression, seconds = 30) => {
  for (let i = 0; i < seconds * 4; i++) {
    if (await drive.evaluate(expression)) return
    await sleep(250)
  }
  throw new Error(`Timed out: ${expression}`)
}
const powershell = (script) => new Promise((resolve_, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 40_000 }, (error, stdout) => error ? reject(error) : resolve_(stdout.trim())))
async function idleCpu() {
  return Number(await powershell(`$list=Get-CimInstance Win32_Process; $ids=@(${drive.pid}); do { $old=$ids.Count; $ids+=@($list | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids} | ForEach-Object ProcessId) } while($ids.Count -gt $old); $before=@{}; foreach($id in $ids){try{$before[$id]=(Get-Process -Id $id -ErrorAction Stop).TotalProcessorTime.TotalSeconds}catch{}}; $watch=[Diagnostics.Stopwatch]::StartNew(); Start-Sleep -Seconds 10; $cpu=0; foreach($id in $before.Keys){try{$cpu+=(Get-Process -Id $id -ErrorAction Stop).TotalProcessorTime.TotalSeconds-$before[$id]}catch{}}; $cores=[Environment]::ProcessorCount; [Console]::WriteLine(($cpu/$watch.Elapsed.TotalSeconds/$cores*100).ToString([Globalization.CultureInfo]::InvariantCulture))`))
}
try {
  await drive.capture('ready, no voice assets loaded', () => drive.ready())
  check('a microphone is drawn', await drive.evaluate(`!!document.querySelector('[aria-label="Voice typing"]')`))
  check('no voice directory before the first press', !(await readdir(profile)).includes('voice'))
  const baselineCpu = await idleCpu()
  measurements.baselineFocusedCpu = baselineCpu
  await drive.evaluate(`document.querySelector('[aria-label="Voice typing"]').click()`)
  await wait(`!!document.querySelector('[aria-label="Download voice typing"]')`)
  check('exact first-use consent words', await drive.evaluate(`document.querySelector('[aria-label="Download voice typing"]').innerText.includes('Voice typing needs a one-time 41 MB download. It runs on this computer; nothing you say leaves it.')`))
  await drive.capture('one-time download consent', () => 'Download and Not now, in place')
  await drive.evaluate(`document.querySelector('[aria-label="Download voice typing"] button:last-child').click()`)
  check('Not now downloads nothing', !(await readdir(profile)).includes('voice'))
  // Preserve both sides of the cursor, making replacement of the whole box fail.
  await drive.evaluate(`(() => { const box=document.querySelector('form.command-dock textarea'); const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(box,'BEFORE  AFTER'); box.dispatchEvent(new Event('input',{bubbles:true})); box.focus(); box.setSelectionRange(7,7); document.querySelector('[aria-label="Voice typing"]').click(); })()`)
  await wait(`!!document.querySelector('[aria-label="Download voice typing"]')`)
  await drive.evaluate(`document.querySelector('[aria-label="Download voice typing"] button').click()`)
  await wait(`!!document.querySelector('[aria-label="Stop voice typing"]') || !!document.querySelector('.lc-voice__message')`, 180)
  const error = await drive.evaluate(`document.querySelector('.lc-voice__message')?.innerText ?? ''`)
  check('real download and fake microphone start', await drive.evaluate(`!!document.querySelector('[aria-label="Stop voice typing"]')`), error)
  check('download has only retained runtime/model files', (await readdir(join(profile, 'voice'))).filter((name) => name.endsWith('.exe') || name.endsWith('.dll') || name.endsWith('.bin')).length === 7)
  check('download retains license notices', (await readdir(join(profile, 'voice'))).includes('LICENSE.txt'))
  await sleep(10_000)
  await drive.capture('recording, visible elapsed time', () => drive.evaluate(`document.querySelector('[aria-label="Stop voice typing"]').innerText`))
  await drive.evaluate(`document.querySelector('[aria-label="Stop voice typing"]').click()`)
  await wait(`!document.querySelector('.lc-voice__button:disabled')`, 120)
  const text = await drive.evaluate(`document.querySelector('form.command-dock textarea').value`)
  check('transcript at the cursor, surrounding draft preserved', /^BEFORE Please review the latest changes/i.test(text) && /new version\. AFTER$/.test(text), text)
  const files = await readdir(join(profile, 'mission-ledger'))
  check('no mission sent', !files.some((name) => name.endsWith('.jsonl')))
  check('transient WAV folder removed', !(await readdir(join(profile, 'voice'))).some((name) => name.startsWith('recording-')))
  const escaped = await powershell(`$root='${join(profile, 'voice').replaceAll("'", "''")}'; $found=@(Get-CimInstance Win32_Process -Filter "Name = 'whisper-cli.exe'" | Where-Object {$_.ExecutablePath -like "$root*"}); [Console]::WriteLine($found.Count)`)
  check('no owned whisper process after transcription', Number(escaped) === 0)
  await drive.capture('editable transcript, unsent', () => text)
  await drive.evaluate(`document.querySelector('[aria-label="Voice typing"]').click()`)
  await wait(`!!document.querySelector('[aria-label="Stop voice typing"]')`)
  await sleep(1000)
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(`document.querySelector('.lc-voice__button')?.getAttribute('aria-pressed') === 'false'`)
  check('Escape leaves draft unchanged', await drive.evaluate(`document.querySelector('form.command-dock textarea').value`) === text)
  check('recording ends on Escape', await drive.evaluate(`document.querySelector('[aria-label="Stop voice typing"]') === null`))
  const afterCpu = await idleCpu()
  measurements.afterFocusedCpu = afterCpu
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await drive.evaluate('window.desktop.minimize()')
  await sleep(1000)
  const minimizedCpu = await idleCpu()
  measurements.afterMinimizedCpu = minimizedCpu
  check('no captured renderer errors', drive.record.every((step) => step.errors.length === 0))
  // Do not weaken the foreground acceptance check just because the minimized app is cheap.
  check('whole app idle CPU below 1% after dictation', afterCpu < 1, `baseline ${baselineCpu.toFixed(3)}%, after ${afterCpu.toFixed(3)}%, minimized ${minimizedCpu.toFixed(3)}%`)
} finally {
  await writeFile(join(drive.out, 'VOICE-RESULTS.json'), JSON.stringify({ checks, measurements, profile }, null, 2) + '\n')
  await writeFile(join(drive.out, 'checks.json'), JSON.stringify(checks, null, 2) + '\n')
  await drive.finish({ intro: 'Voice dictation: real pinned download and local fake microphone; no agent turns.' })
}
