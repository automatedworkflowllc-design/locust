// The face you are talking to hops; its copies in the sidebar and the header
// look around and bounce a little -- measured on the built app.
//
//   node _tools/drive-calm-bots.mjs [--packaged <exe>]
//
// Colin, 2026-09-23: "the one in the chat where you're speaking to, all that
// movement is fine and great and you did a good job, but its mirrored in the
// sidebar and the top, lets tame those two down a bit". One message to Yurt
// (a ghost, as in his frame) on the free OpenCode route. While it runs, every
// bot on screen is sampled ten times a second for two things:
//
//   - how far its body moves INSIDE its canvas: the top of the drawn body,
//     as a share of the bot's size. A hop lifts it by 0.18 of its size, a
//     flip by 0.26; looking around and breathing move it a few hundredths.
//   - how far the bounce moves the WHOLE face: the element's own transform,
//     read from its computed style (layout shifts in the sidebar do not
//     count, which a bounding box would).
//
// Spends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('calm-bots-2026-09-23'), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

const mate = (id, name, hue, shape, extra = {}) => ({
  teammateId: id,
  name,
  hue,
  role: 'Code & Migrations',
  avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape, face: 'eyes' } },
  createdAt: '2026-09-23T04:00:00.000Z',
  ...extra
})
// His frame: Yurt the ghost working, then a swarm, an alien and a drop.
const TEAM = [
  mate('tm_yurt00000000000000000001', 'Yurt', 'pearl', 'ghost', { route: { ...FREE_ROUTE } }),
  mate('tm_gem000000000000000000002', 'Gem', 'blue', 'swarm'),
  mate('tm_atlas0000000000000000003', 'Atlas', 'lime', 'alien'),
  mate('tm_drip00000000000000000004', 'Drip', 'teal', 'drop')
]

const workspace = await scratchRepository('locust-drive-calm-ws-')
const drive = await startDrive({
  name: 'calm-bots',
  port: 9401,
  workspace,
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

// Runs in the page: a sampler that keeps going until stop() hands back
// what it saw, one record per bot element.
const SAMPLER = `(() => {
  if (window.__calm) window.__calm.stop()
  const ids = new WeakMap()
  let next = 0
  const bots = {}
  const where = (el) => el.closest('.lc-livestep') ? 'thread'
    : el.closest('.lc-workroom__identity') ? 'header'
    : el.closest('.lc-faces') ? 'sidebar strip'
    : el.closest('.lc-sidebar') ? 'sidebar row'
    : 'elsewhere'
  const topOf = (canvas) => {
    const context = canvas.getContext('2d')
    if (!context) return -1
    const { width, height } = canvas
    const data = context.getImageData(0, 0, width, height).data
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 64) return y
    }
    return -1
  }
  const sample = () => {
    for (const el of document.querySelectorAll('.lc-bot[data-motion]')) {
      const canvas = el.querySelector('canvas')
      if (!canvas || canvas.width === 0) continue
      if (!ids.has(el)) ids.set(el, next++)
      const id = ids.get(el)
      const size = parseFloat(el.style.width) || el.getBoundingClientRect().width
      const shown = parseFloat(canvas.style.height) || canvas.getBoundingClientRect().height
      const row = topOf(canvas)
      const transform = getComputedStyle(el).transform
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
      const bot = bots[id] ?? (bots[id] = { where: where(el), bot: el.dataset.bot, teammate: el.dataset.teammate ?? '', motion: el.dataset.motion, size, samples: [] })
      bot.samples.push({ t: Math.round(performance.now()), a: el.dataset.activity, top: row < 0 ? null : (row / (canvas.height / shown)) / size, lift: -matrix.f / size, bouncing: el.classList.contains('is-bouncing'), glance: el.dataset.glance ?? null, shown, pixels: canvas.height })
    }
  }
  const timer = setInterval(sample, 100)
  window.__calm = { stop: () => { clearInterval(timer); return bots } }
  return 'sampling'
})()`

const WORK = new Set(['working', 'delegating'])
const STILL = new Set(['idle', 'blocked', 'done'])
const spread = (values) => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values))

try {
  await drive.ready()
  await drive.resize(1120, 720)
  await drive.waitFor(`!!document.querySelector('.lc-intro')`, { timeoutMs: 40_000, what: 'probing done' })
  await sleep(1500)

  const opened = await drive.evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('button')]
    const yurt = buttons.find((b) => /Yurt/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    if (!yurt) return 'NO YURT BUTTON'
    yurt.click()
    await new Promise((r) => setTimeout(r, 700))
    return 'opened'
  })()`)
  say(`Yurt: ${opened}`)
  const chip = () => drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  let route = await chip()
  if (!/opencode/i.test(route) || !/free/i.test(route)) {
    say(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
    route = await chip()
  }
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  say(`route: ${route}`)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(field, 'Read README.md and LOCUST.md, list the files in this folder, then describe this project in three sentences.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'send button never enabled'
  })()`)
  await drive.waitFor(`!!document.querySelector('button[aria-label^="Stop the running"]')`, { timeoutMs: 30_000, what: 'the run to start' })
  say(await drive.evaluate(SAMPLER))

  // Frames while it runs, and then until it ends or a minute passes.
  await sleep(1500)
  await shoot('01-running.png')
  await sleep(2500)
  await shoot('02-running.png')
  for (let waited = 0; waited < 60_000; waited += 1000) {
    const running = await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`)
    if (!running) break
    await sleep(1000)
  }
  const bots = Object.values(JSON.parse(await drive.evaluate(`JSON.stringify(window.__calm.stop())`)))
  await shoot('03-finished.png')

  const moving = bots.filter((bot) => bot.samples.some((s) => !STILL.has(s.a)))
  for (const bot of moving) {
    const animated = bot.samples.filter((s) => !STILL.has(s.a) && s.top !== null)
    const working = animated.filter((s) => WORK.has(s.a))
    bot.body = spread(animated.map((s) => s.top))
    bot.bodyAtWork = spread(working.map((s) => s.top))
    bot.bounce = spread(working.map((s) => s.lift))
    bot.counted = { animated: animated.length, working: working.length }
    say(`${bot.where.padEnd(13)} ${bot.bot.padEnd(6)} ${String(bot.size).padStart(2)}px ${bot.motion.padEnd(6)} -- ${String(animated.length)} animated samples (${String(working.length)} at work); body moved ${bot.body.toFixed(3)} of its size (${bot.bodyAtWork.toFixed(3)} at work), the face bounced ${bot.bounce.toFixed(3)}`)
  }

  const yurts = moving.filter((bot) => bot.bot === 'ghost')
  const thread = yurts.filter((bot) => bot.where === 'thread')
  const copies = yurts.filter((bot) => bot.where === 'header' || bot.where.startsWith('sidebar'))
  check('Yurt was on screen in the thread, the header and the sidebar while it ran', thread.length > 0 && copies.some((b) => b.where === 'header') && copies.some((b) => b.where.startsWith('sidebar')), yurts.map((b) => b.where).join(', '))
  check('the face in the thread asks for the full performance, and it alone', thread.every((b) => b.motion === 'full') && moving.filter((b) => b.motion === 'full').every((b) => b.where === 'thread'), moving.map((b) => `${b.where}:${b.motion}`).join(', '))
  check('the header and sidebar copies are subtle', copies.length > 0 && copies.every((b) => b.motion === 'subtle'))
  const worked = thread.filter((b) => b.counted.working >= 10)
  check('the face in the thread hops at work (its body lifts by more than a tenth of its size)', worked.length > 0 && worked.every((b) => b.bodyAtWork >= 0.12), worked.map((b) => b.bodyAtWork.toFixed(3)).join(', ') || 'never at work for a second')
  const calm = copies.filter((b) => b.counted.animated >= 10)
  // A FIFTH, NOT A TWELFTH (0.368). The subtle idle's own slow bob spans
  // about a fifteenth of the size -- measured alone for 65 s, identically on
  // 0.299's library-drawn bots and 0.367's rig -- and a busy renderer's late
  // frames add a row at either end of it, so a minute of samples reads 0.10
  // to 0.13 with nothing wrong (0.367 sweep and rerun). The twelfth came from
  // a 15-second window that never saw the bob's whole range. What this check
  // is for is far larger: the face in the thread hops 0.4 to 0.6 of its size
  // and flips past 1.
  check('the copies never hop or flip (their bodies move under a fifth of their size)', calm.length > 0 && calm.every((b) => b.body < 0.2), calm.map((b) => `${b.where} ${b.body.toFixed(3)}`).join(', '))
  const bouncers = copies.filter((b) => b.counted.working >= 15)
  check('at work the copies bounce, slightly (a lift between a twenty-fifth and a tenth of their size)', bouncers.length > 0 && bouncers.every((b) => b.bounce >= 0.04 && b.bounce <= 0.1), bouncers.map((b) => `${b.where} ${b.bounce.toFixed(3)}`).join(', ') || 'never at work for a second and a half')
  await writeFile(join(OUT, 'samples.json'), JSON.stringify(moving.map(({ samples, ...rest }) => ({ ...rest, samples: samples.length })), null, 2))
  // Every sample too, so a number that moved can be traced to the moment it moved.
  await writeFile(join(OUT, 'samples-raw.json'), JSON.stringify(moving, null, 1))
  say(failures === 0 ? '\nCALM BOTS PASSED' : `\nCALM BOTS: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The face you talk to hops; its copies look around. One free OpenCode message.' })
}
