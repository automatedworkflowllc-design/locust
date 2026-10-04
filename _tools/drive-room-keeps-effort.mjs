// Does a room post run a teammate at their saved effort (M10)?
//
//   LOCUST_SPEND=1 node _tools/drive-room-keeps-effort.mjs [--packaged <exe>] [--tag <name>]
//
// Wren is saved on Claude Code / Haiku at effort High. A room is made with
// Wren in it and one post goes in. Room posts and relayed replies passed the
// model and dropped the effort, so the run went at Claude's default while
// the chip showed High. The effort is read where it matters: the command
// line of the Claude process the post started, while it runs.
//
// SPENDS a little: one short Haiku run.

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `room-keeps-effort-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const startedAt = new Date()
const drive = await startDrive({
  name: 'room-keeps-effort',
  port: 9581,
  workspace: await scratchRepository('locust-drive-roomeffort-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask', effort: 'high' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
// Claude processes started since this drive began, with their command lines.
const claudeLines = async () => {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'claude' -and $_.CommandLine -match 'haiku' -and $_.CreationDate -gt [datetime]'${startedAt.toISOString()}' } | ForEach-Object { $_.CommandLine }`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
  // Not this query itself, whose own command line names both words.
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !line.includes('Get-CimInstance'))
}

try {
  await drive.capture('launch: Wren on Claude Haiku at High', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1200)
  await drive.capture('make a room with Wren in it', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    const input = document.querySelector('input[aria-label="Room name"]')
    if (!input) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Effort'); input.dispatchEvent(new Event('input', { bubbles: true }))
    for (const m of document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')) if (m.getAttribute('aria-checked') !== 'true') m.click()
    await new Promise(r => setTimeout(r, 300))
    const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
    if (!create || create.disabled) return 'Create room disabled'
    create.click()
    await new Promise(r => setTimeout(r, 900))
    return document.querySelector('.lc-screen__title')?.innerText ?? 'no title'
  })()`))
  await drive.capture('post to the room', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    if (!box) return 'no compose box'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Count from 1 to 120, one number per line, with no other text. Do not edit any files.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    return 'posted'
  })()`))
  let lines = []
  for (let i = 0; i < 60 && lines.length === 0; i += 1) {
    await sleep(500)
    lines = await claudeLines()
  }
  const effort = lines.map((line) => /--effort[= ](\w+)/.exec(line)?.[1] ?? 'none').join(', ')
  say(`  Claude processes: ${String(lines.length)}; --effort: ${effort || 'no process seen'}`)
  for (const line of lines) say(`    ${line.replace(/\s+/g, ' ').slice(0, 260)}`)
  check('the room post started a Claude run', lines.length > 0)
  check('it ran at Wren’s saved effort, High', lines.length > 0 && lines.every((line) => /--effort[= ]high\b/.test(line)), effort)
  await drive.capture('wait for the answer', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      if (phases.length >= 1 && phases.every(p => /completed|failed|cancelled/.test(p))) return phases.join(', ')
    }
    return 'still running'
  })()`))
  say(failures === 0 ? '\nROOM KEEPS EFFORT PASSED' : `\nROOM KEEPS EFFORT: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren saved on Claude Code / Haiku at High; one post to a room of Wren; the Claude process's command line read while it ran.` })
}
