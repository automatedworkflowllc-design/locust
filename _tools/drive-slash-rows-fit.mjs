// Every row of the / menu keeps to one line, whatever its hint (0.432).
//
//   node _tools/drive-slash-rows-fit.mjs [--packaged <exe>] [--tag <name>]
//
// Spends nothing: Claude Code is never sent a message (its list is read at
// launch since 0.428).
//
// Colin, 2026-09-28, with a picture of a Claude Code command whose hint ran
// eighty characters: "some of these bugged" -- the description beside it was
// one word per line. Every row of Claude Code's section is measured, at
// 1440x900 and 1280x720: its height, and the width left for its description.
//
// PRIVACY. The list names the person's own commands and skills: measured
// as numbers only, never named and never pictured.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('slash-rows-fit-2026-09-28'), `slash-rows-fit-${tag}`)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: `slash-rows-fit-${tag}`, port: 9768, workspace: await scratchRepository('locust-drive-slash-rows-ws-'), outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_cleo', name: 'Cleo', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const measure = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, '/')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 60 && !document.querySelector('.lc-slash .lc-slash__group'); i += 1) await new Promise((r) => setTimeout(r, 500))
  const rows = [...document.querySelectorAll('.lc-slash .lc-slash__item')]
  const heights = rows.map((row) => row.getBoundingClientRect().height)
  const details = rows.map((row) => row.querySelector('.lc-slash__detail')?.getBoundingClientRect().width ?? 0)
  const names = rows.map((row) => { const n = row.querySelector('.lc-slash__name'); const h = row.querySelector('.lc-slash__hint'); const t = n?.textContent ?? ''; return t.slice(0, t.length - (h?.textContent.length ?? 0)).trim() })
  const menuWidth = document.querySelector('.lc-slash')?.getBoundingClientRect().width ?? 0
  setter.call(field, '')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return JSON.stringify({
    rows: rows.length,
    menuWidth: Math.round(menuWidth),
    tallest: Math.round(Math.max(...heights)),
    shortest: Math.round(Math.min(...heights)),
    narrowestDetail: Math.round(Math.min(...details)),
    detailsUnder160: details.filter((w) => w < 160).length,
    titled: rows.filter((row) => (row.getAttribute('title') ?? '').length > 0).length,
    autoModeSetup: names.includes('/auto-mode-setup')
  })
})()`

try {
  await drive.ready()
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Cleo'))
  for (const [width, height] of [[1440, 900], [1280, 720]]) {
    await drive.resize(width, height)
    await sleep(1200)
    const read = JSON.parse(String(await drive.evaluate(measure)))
    say(`  ${width}x${height}: ${JSON.stringify(read)}`)
    check(`at ${width}x${height}, every row is one line (no taller than the shortest)`, read.rows > 20 && read.tallest <= read.shortest + 2, JSON.stringify(read))
    check(`at ${width}x${height}, every description keeps at least 160px`, read.detailsUnder160 === 0, JSON.stringify(read))
    check(`at ${width}x${height}, every row says all of itself on hover`, read.titled === read.rows, JSON.stringify(read))
  }
  const last = JSON.parse(String(await drive.evaluate(measure)))
  check('/auto-mode-setup is not offered', last.autoModeSetup === false, JSON.stringify(last))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Cleo on Claude Code, never sent anything; the whole / menu measured as numbers, never named or pictured.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
