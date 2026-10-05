// Does an OPEN model picker catch up when a slow agent's check lands? (0.639)
//
//   node _tools/probe-picker-after-a-late-check.mjs [--packaged <Locust.exe>] [--seconds 40]
//
// Since 0.634 the first screen waits for no agent past two seconds: one still
// being checked shows its rows as CHECKING, and its answer is put in when it
// lands. A drive (drive-compare-in-any-folder on the packaged 0.638) opened
// the picker in those first seconds and found OpenCode's free rows CHECKING
// for two minutes. This opens the picker at once, keeps it open, and each
// second notes whether OpenCode's rows still say CHECKING, beside when the
// app's own discovery log says OpenCode's check answered; then closes and
// reopens the picker and reads them again. Sends nothing.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const seconds = Number(arg('--seconds') ?? '40')

const drive = await startDrive({
  name: 'picker-after-a-late-check',
  port: 9936,
  workspace: await scratchRepository('locust-probe-picker-late-ws-'),
  sendsNothing: true,
  outPath: join(recordRoot('picker-after-a-late-check-2026-10-05'), packaged === undefined ? 'dev' : 'packaged'),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

const OPEN = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  if (!document.querySelector('.lc-picker')) control.click()
  await new Promise(r => setTimeout(r, 600))
  const box = document.querySelector('.lc-picker__input')
  if (box) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'free')
    box.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return document.querySelector('.lc-picker') ? 'open' : 'not open'
})()`
const CLOSE = `(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('.lc-picker') && document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 500)); return document.querySelector('.lc-picker') ? 'still open' : 'closed' })()`
const READ = `(async () => {
  const rows = [...document.querySelectorAll('.lc-picker__row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())
  const free = rows.filter(r => /free/i.test(r))
  const log = await window.desktop.discoveryLog()
  const answered = log.filter(e => e.kind === 'probe.finished' && e.id === 'opencode').map(e => e.at)
  const connected = /^(\\d+) AI agent/.exec(document.querySelector('.lc-connected')?.getAttribute('title') ?? '')?.[1] ?? null
  return JSON.stringify({ open: Boolean(document.querySelector('.lc-picker')), free: free.length, checking: free.filter(r => /CHECKING/.test(r)).length, opencodeAnsweredAt: answered, connected })
})()`
/** Which read still says OpenCode is being checked: the window's runtime list, or the model catalog. Asked twice only: each ask can start a check. */
const SOURCES = `(async () => {
  const found = await window.desktop.getLocalRuntimes().catch(() => undefined)
  const opencode = found?.ok ? found.data.runtimes.find((r) => r.id === 'opencode') : undefined
  const catalog = await window.desktop.listModels().catch(() => undefined)
  const models = catalog?.ok ? catalog.data.models.filter((m) => /free/i.test(String(m.id ?? ''))) : []
  return JSON.stringify({ runtimeList: opencode === undefined ? 'absent' : { status: opencode.status, checking: opencode.checking === true }, catalogFree: models.length, catalogSample: models[0] === undefined ? null : Object.fromEntries(Object.entries(models[0]).filter(([k]) => !['variants', 'efforts'].includes(k)).slice(0, 10)) })
})()`

let failures = 0
try {
  const readyAt = Date.now()
  await drive.ready()
  say(`  ready after ${String(Date.now() - readyAt)} ms`)
  say(`  picker: ${String(await drive.evaluate(OPEN))}`)
  const series = []
  for (let s = 0; s < seconds; s += 1) {
    const got = JSON.parse(String(await drive.evaluate(READ)))
    series.push(`${String(s)}s:${String(got.checking)}/${String(got.free)}${got.opencodeAnsweredAt.length > 0 ? '*' : ''}c${String(got.connected)}`)
    if (s === 0 || got.opencodeAnsweredAt.length > 0 && !series.some((one) => one.includes('answered'))) say(`  ${String(s)} s: ${JSON.stringify(got)}`)
    if (s === 10) say(`  sources at 10 s: ${String(await drive.evaluate(SOURCES))}`)
    await sleep(1000)
  }
  say(`  sources at the end: ${String(await drive.evaluate(SOURCES))}`)
  // Seconds the open picker still said CHECKING after OpenCode's check had answered.
  say(`  CHECKING_AFTER_ANSWER=${String(series.filter((one) => /\*/.test(one) && /^\d+s:[1-9]/.test(one)).length)}s`)
  say(`  OPEN THE WHOLE TIME (checking/free rows; * = OpenCode's check had answered): ${series.join(' ')}`)
  say(`  close: ${String(await drive.evaluate(CLOSE))}`)
  say(`  reopen: ${String(await drive.evaluate(OPEN))}`)
  await sleep(1500)
  const after = JSON.parse(String(await drive.evaluate(READ)))
  say(`  REOPENED: ${JSON.stringify(after)}`)
  const last = series.at(-1) ?? ''
  if (/^\d+s:[1-9]/.test(last) && /\*$/.test(last)) {
    failures += 1
    say('  FINDING: OpenCode had answered, and the open picker still said CHECKING')
  }
  await drive.capture('the picker at the end', async () => {})
} catch (error) {
  failures += 1
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The model picker opened at once and held open while a slow agent's check lands.`, extra: `Findings: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
