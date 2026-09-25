// After a handoff, does the composer stay on the runtime handed to (M29)?
//
//   LOCUST_SPEND=1 node _tools/drive-handoff-keeps-route.mjs [--packaged <exe>] [--tag <name>]
//
// The person picks Wren's route in the picker -- the free OpenCode model --
// and sends a slow task. Mid-run they pick Claude Code / Haiku, which hands
// the run over. When the continuation ends, the chat box must still read
// Claude: it went back to OpenCode, because the earlier pick was kept per
// teammate and preferred over the route the handoff set, so the next
// follow-up went to the runtime the person had just left.
//
// SPENDS a little: the continuation runs on Claude Haiku.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `handoff-keeps-route-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const drive = await startDrive({
  name: 'handoff-keeps-route',
  port: 9579,
  workspace: await scratchRepository('locust-drive-handroute-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
// Picks the first enabled row under a group matching `group` whose text matches `row`.
const pick = (group, row) => `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  control.click()
  await new Promise(r => setTimeout(r, 600))
  const picker = document.querySelector('.lc-picker')
  if (!picker) return 'picker did not open'
  let current = ''
  let target
  for (const node of picker.querySelector('.lc-picker__list').children) {
    const header = node.querySelector('.lc-picker__group')
    if (header) current = header.innerText
    const item = node.querySelector('.lc-picker__row')
    if (item && !item.disabled && ${group}.test(current) && ${row}.test(item.innerText.trim())) { target = item; break }
  }
  if (!target) return 'no row: ' + [...picker.querySelectorAll('.lc-picker__row')].map(r => r.innerText.replace(/\\s+/g, ' ')).slice(0, 8).join(' | ')
  const name = target.innerText.replace(/\\s+/g, ' ').trim()
  target.click()
  await new Promise(r => setTimeout(r, 800))
  return 'picked ' + name
})()`
const chip = () => drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no chip'`).then(String)

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  const first = String(await drive.capture('pick the free OpenCode model in the picker', () => drive.evaluate(pick('/opencode/i', /free/i))))
  check('the free OpenCode model was picked', /^picked/.test(first), first)
  await drive.capture('send a slow task', () => drive.evaluate(sendAndWaitScript('Count from 1 to 500. Put each number on its own line, in order, with no other text and no commentary. Do not stop early and do not summarise. Do not edit any files.', { settle: false })))
  const live = String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 160; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'live'
    }
    return 'NOT LIVE'
  })()`))
  check('the premise: a run is live to hand off', live === 'live', live)
  const handed = String(await drive.capture('pick Claude Code / Haiku while it runs', () => drive.evaluate(pick('/claude/i', /^haiku/i))))
  check('Claude Haiku was picked mid-run', /^picked/.test(handed), handed)
  const divider = String(await drive.capture('the handoff divider, then the continuation ends', () => drive.evaluate(`(async () => {
    let seen = false
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (document.querySelector('.lc-handoff')) seen = true
      if (seen && i > 10 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return seen ? 'divider: ' + document.querySelector('.lc-handoff').innerText.replace(/\\s+/g, ' ').slice(0, 160) : 'no divider'
  })()`)))
  check('the run was handed over', /^divider/.test(divider), divider)
  await sleep(1500)
  const after = await chip()
  await drive.capture('the chat box after the continuation', () => after)
  check('the chat box still reads Claude', /claude/i.test(after) && !/opencode/i.test(after), after)
  say(failures === 0 ? '\nHANDOFF KEEPS ROUTE PASSED' : `\nHANDOFF KEEPS ROUTE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren's free OpenCode model picked in the picker; a slow task; Claude Code / Haiku picked mid-run.` })
}
