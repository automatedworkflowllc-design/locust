// Does the Missions row time a run with the same clock as the thread?
//
//   LOCUST_SPEND=1 node _tools/drive-one-clock.mjs [--packaged <exe>] [--tag <name>]
//
// Yurt's beta report (2026-09-23, #14): a turn's fold said 37s and the
// Missions row said 43s for the same mission, and the row led with
// "0 checkpoints". One Haiku turn that runs a command, then the thread's fold
// line and the Missions row, side by side. Spends one cheap turn.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const drive = await startDrive({
  name: `one-clock-${tag}`,
  port: 9422,
  workspace: await scratchRepository('locust-drive-one-clock-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 500)) })()`)
  await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/haiku/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  say(`route: ${route}`)

  const fold = JSON.parse(await drive.capture('one turn that runs a command', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Use the Bash tool to run: echo one. Then reply with exactly: DONE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    field.form.requestSubmit()
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const allow = [...document.querySelectorAll('button')].find((b) => /^(Approve|Allow) once$/.test(b.innerText.trim()))
      if (allow) allow.click()
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]') && !document.querySelector('.lc-livestep')) break
    }
    await new Promise((r) => setTimeout(r, 1500))
    const segments = [...document.querySelectorAll('.lc-thread .lc-trace__seg')].map((node) => node.innerText.trim())
    return JSON.stringify({ segments })
  })()`)))
  say(`fold line: ${fold.segments.join(' · ')}`)

  const row = JSON.parse(await drive.capture('the Missions screen', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Missions')
    if (!tab) return JSON.stringify({ error: 'no Missions button' })
    tab.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-missionrow__stats'); i += 1) await new Promise((r) => setTimeout(r, 250))
    const rows = [...document.querySelectorAll('.lc-missionrow')].map((node) => ({
      title: node.querySelector('.lc-missionrow__title')?.innerText.trim() ?? '',
      stats: node.querySelector('.lc-missionrow__stats')?.innerText.trim() ?? ''
    }))
    return JSON.stringify({ rows })
  })()`)))
  say(`missions: ${JSON.stringify(row.rows)}`)

  const foldClock = fold.segments[0] ?? ''
  const rowStats = row.rows?.[0]?.stats ?? ''
  check('the turn ran and its fold line states a duration', /^\d+(\.\d+)?(s|m|h)/.test(foldClock), foldClock)
  check('the Missions row states the same duration', rowStats.length > 0 && rowStats.endsWith(foldClock), `row "${rowStats}" vs fold "${foldClock}"`)
  check('and does not lead with "0 checkpoints"', !/\b0 checkpoints\b/.test(rowStats), rowStats)
  say(failures === 0 ? '\nONE CLOCK PASSED' : `\nONE CLOCK: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "One Haiku turn: the thread's fold-line duration and the Missions row's, side by side." })
}
