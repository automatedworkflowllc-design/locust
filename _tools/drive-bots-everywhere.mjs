// Every teammate as a bot: the sidebar, the Team screen, the New teammate
// dialog's Look grid -- and what a roster of idle bots costs.
//
//   node _tools/drive-bots-everywhere.mjs [--packaged <exe>]
//
// Colin, 2026-09-22: "we're going to have to make miniature versions of the
// little bots for our sidebar as well and chat as well and teammate picker
// panel". Seeds eight teammates across the colours, one with a picked shape,
// photographs each surface, and measures the renderer's CPU over five idle
// seconds with the roster on screen (idle bots should be still, and cost
// nothing). Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(new URL('../docs/bots-everywhere-2026-09-22/', import.meta.url).pathname.slice(1), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

const mate = (id, name, hue, headwear, accessory, mouth, bot) => ({
  teammateId: id,
  name,
  hue,
  role: 'Code & Migrations',
  avatar: { headwear, accessory, mouth, ...(bot === undefined ? {} : { bot }) },
  createdAt: '2026-09-22T20:00:00.000Z'
})
const TEAM = [
  mate('tm_wren00000000000000000001', 'Wren', 'lime', 1, 0, 0),
  mate('tm_atlas0000000000000000002', 'Atlas', 'blue', 2, 1, 0),
  mate('tm_sable0000000000000000003', 'Sable', 'pearl', 4, 2, 3, { shape: 'ghost', face: 'eyes' }),
  mate('tm_gem000000000000000000004', 'Gem', 'teal', 0, 1, 2),
  mate('tm_pip000000000000000000005', 'Pip', 'butter', 3, 0, 1),
  mate('tm_juno00000000000000000006', 'Juno', 'rose', 5, 2, 0),
  mate('tm_moss00000000000000000007', 'Moss', 'slate', 2, 2, 2),
  mate('tm_ivo000000000000000000008', 'Ivo', 'violet', 1, 1, 3, { shape: 'hopper', face: 'eyes' })
]

const workspace = await scratchRepository('locust-drive-bots-ws-')
const drive = await startDrive({
  name: 'bots-everywhere',
  port: 9399,
  workspace,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: TEAM, missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const shoot = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
const botsOn = (selector) => `JSON.stringify([...document.querySelectorAll('${selector} .lc-bot[data-bot]')].map((b) => ({ bot: b.getAttribute('data-bot'), activity: b.getAttribute('data-activity'), size: Math.round(b.getBoundingClientRect().width), drawn: (b.querySelector('canvas')?.width ?? 0) > 0 })))`

try {
  await drive.ready()
  await sleep(1500)
  const sidebar = JSON.parse(await drive.evaluate(botsOn('.lc-sidebar')))
  say(`sidebar bots: ${sidebar.map((b) => `${b.bot}@${b.size}`).join(', ')}`)
  // The roster strip shows four faces and then "+N" -- by design.
  const more = await drive.evaluate(`document.querySelector('.lc-sidebar')?.textContent.match(/\\+(\\d+)/)?.[1] ?? '0'`)
  check('the roster strip is bots, drawn, four and a count', sidebar.length === 4 && sidebar.every((b) => b.drawn) && Number(more) === TEAM.length - 4, `${sidebar.length} bots, +${more}`)
  check("a picked shape is kept: Sable's ghost", sidebar.some((b) => b.bot === 'ghost'))
  check('no pixel face is left in the sidebar', (await drive.evaluate(`document.querySelectorAll('.lc-sidebar .lc-face__chip').length`)) === 0)
  await shoot('01-sidebar.png')

  // What bots cost: the renderer's task time over five seconds, on the
  // home screen (the title's three animate) and then on the Team screen.
  await drive.send('Performance.enable')
  const metric = async () => {
    const result = await drive.send('Performance.getMetrics')
    const read = (name) => result?.result?.metrics?.find((entry) => entry.name === name)?.value ?? 0
    return { task: read('TaskDuration'), script: read('ScriptDuration') }
  }
  const busyFor = async (label) => {
    const before = await metric()
    await sleep(5000)
    const after = await metric()
    const busy = ((after.task - before.task) / 5) * 100
    say(`renderer busy over 5 s, ${label}: ${busy.toFixed(1)}% (script ${(((after.script - before.script) / 5) * 100).toFixed(1)}%)`)
    return busy
  }
  const homeBusy = await busyFor("home screen, the title's three bots animating")

  // The Team screen.
  await drive.evaluate(`(async () => {
    const team = [...document.querySelectorAll('button, a')].find((el) => /^\\s*Team\\s*$/.test(el.textContent ?? ''))
    team?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 'ok'
  })()`)
  const screen = JSON.parse(await drive.evaluate(botsOn('.lc-main, main, .lc-workroom')))
  say(`team screen bots: ${screen.map((b) => `${b.bot}@${b.size}`).join(', ')}`)
  check('the Team screen shows every teammate as a bot, Ivo a Hopper', screen.length >= TEAM.length && screen.some((b) => b.bot === 'hopper'), `${screen.length} bots`)
  await shoot('02-team.png')
  const teamBusy = await busyFor(`Team screen, ${String(screen.length)} idle bots and no title`)
  check('idle bots cost next to nothing (under 3% busy)', teamBusy < 3, `${teamBusy.toFixed(1)}%`)
  say(`the title's three animating bots: about ${(homeBusy - teamBusy).toFixed(1)}% of the renderer`)

  // The New teammate dialog and its Look grid.
  const dialog = JSON.parse(await drive.evaluate(`(async () => {
    const add = [...document.querySelectorAll('button[aria-label="Add"]')].find((b) => b.getBoundingClientRect().width > 0)
    add?.click()
    await new Promise((r) => setTimeout(r, 300))
    ;[...document.querySelectorAll('.lc-menu__item')].find((b) => /New teammate/.test(b.textContent))?.click()
    await new Promise((r) => setTimeout(r, 900))
    const grid = document.querySelector('.lc-lookgrid')
    return JSON.stringify({ looks: grid ? grid.querySelectorAll('.lc-look').length : 0, drawn: grid ? [...grid.querySelectorAll('canvas')].filter((c) => c.width > 0).length : 0, colours: document.querySelectorAll('.lc-hues [role="radio"]').length })
  })()`))
  say(`new teammate dialog: ${JSON.stringify(dialog)}`)
  check('the Look grid offers all twenty shapes, drawn', dialog.looks === 20 && dialog.drawn === 20, JSON.stringify(dialog))
  check('nine colours', dialog.colours === 9, String(dialog.colours))
  await shoot('03-new-teammate.png')
  // Pick the Swarm, and see the preview take it.
  const picked = await drive.evaluate(`(async () => {
    document.querySelector('.lc-look[aria-label="Swarm, a Locust"]')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return document.querySelector('.lc-dialog__identity .lc-bot')?.getAttribute('data-bot') ?? ''
  })()`)
  check('choosing a look changes the preview', picked === 'swarm', picked)
  await shoot('04-look-picked.png')
  say(failures === 0 ? '\nBOTS EVERYWHERE PASSED' : `\nBOTS EVERYWHERE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Every teammate as a bot.' })
}
