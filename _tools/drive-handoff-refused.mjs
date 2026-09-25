// Does a handoff the target would refuse leave the run running (M9)?
//
//   LOCUST_SPEND=1 node _tools/drive-handoff-refused.mjs [--packaged <exe>] [--tag <name>]
//
// Wren counts on the free OpenCode model, in Ask. While it runs, the person
// picks Cursor from the route picker. On Windows Cursor cannot be held
// read-only, so the new run is refused -- and that was learned only after the
// running mission had been stopped: the work in flight was lost and nothing
// ran on either side. Now the refusal comes first, the run goes on, and the
// reason is in the chat box.
//
// Spends nothing: the run is on a free model, and Cursor is refused before it
// starts in both builds. LOCUST_SPEND=1 only lets the window offer Cursor at
// all -- a drive's window otherwise refuses every paid route, first.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `handoff-refused-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-handrefused-ws-')
const drive = await startDrive({
  name: 'handoff-refused',
  port: 9573,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.capture('Wren starts a slow task on the free model, in Ask', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(sendAndWaitScript('Count from 1 to 600. Put each number on its own line, in order, with no other text and no commentary. Do not stop early and do not summarise. Do not edit any files.', { settle: false }))
  })
  const live = String(await drive.capture('the run is live', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 160; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'live'
    }
    return 'NOT LIVE'
  })()`)))
  check('the premise: a run is live to hand off', live === 'live', live)
  const picked = String(await drive.capture('pick Cursor from the route picker while it runs', () => drive.evaluate(`(async () => {
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
      const row = node.querySelector('.lc-picker__row')
      if (row && !row.disabled && /cursor/i.test(current)) { target = row; break }
    }
    if (!target) return 'no Cursor row: ' + [...picker.querySelectorAll('.lc-picker__group')].map(g => g.innerText.replace(/\\s+/g, ' ')).join(' | ')
    const name = target.innerText.replace(/\\s+/g, ' ').trim()
    target.click()
    await new Promise(r => setTimeout(r, 4000))
    return 'picked ' + name
  })()`)))
  check('Cursor was offered and picked', /^picked/.test(picked), picked)
  const after = JSON.parse(String(await drive.capture('after the pick', () => drive.evaluate(`JSON.stringify({
    running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
    divider: document.querySelector('.lc-handoff') !== null,
    notice: [...document.querySelectorAll('.lc-notice')].map(n => n.innerText.replace(/\\s+/g, ' ').trim()).join(' | '),
    failed: [...document.querySelectorAll('.lc-thread [role="alert"], .lc-thread .lc-error, .lc-thread .is-failed')].map(n => n.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200)).join(' | ')
  })`))))
  say(`  after: ${JSON.stringify(after)}`)
  check('the run is still running', after.running === true)
  check('nothing was handed over', after.divider === false)
  check('the chat box says why, and that nothing was stopped', /cannot be held read-only/.test(after.notice) && /Nothing was stopped/.test(after.notice), after.notice || 'no notice')
  await drive.capture('stop the run, as the person would', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label^="Stop the running"]')?.click()
    await new Promise(r => setTimeout(r, 3000))
    return document.querySelector('button[aria-label^="Stop the running"]') === null ? 'stopped' : 'still running'
  })()`))
  say(failures === 0 ? '\nHANDOFF REFUSED PASSED' : `\nHANDOFF REFUSED: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on the free OpenCode model in Ask; Cursor picked from the route picker mid-run, on Windows.` })
}
