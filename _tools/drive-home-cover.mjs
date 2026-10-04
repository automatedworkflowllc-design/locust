// Is the home screen the design system's cover, and does it come on after probing?
//
//   node _tools/drive-home-cover.mjs [--tube full|subtle|off] [--packaged <exe>]
//
// Colin, 2026-09-22, of 0.270's home screen: "it can be a 1:1 once you fix
// the text description under locust tbh ... cause right now it just looks
// like the locust logo and crt shipped". This launches the app with its
// loading screen and records, from the first moment: whether the three
// teammates are still while probing and take their states when it is done,
// when the lockup lights and lights again. Then it measures the cover at
// three window sizes -- the smallest allowed, the drive's own, and a full HD
// screen -- and takes frames of each: the scale, whether the claim is centred
// under the lockup, the claim's and the name's real faces, and where the
// card sits in the pane. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tube = arg('--tube') ?? 'full'
// Bots since 0.274; the pixel-face cover's frames stay in docs/home-cover-2026-09-22.
// --out keeps a new run from writing over the 9/22 records, which are tracked.
const OUT = arg('--out') ?? join(recordRoot('home-cover-bots-2026-09-22'), (packaged === undefined ? 'local' : 'packaged') + (tube === 'full' ? '' : '-tube-' + tube))
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-cover-ws-')
const drive = await startDrive({
  name: 'home-cover',
  port: 9396,
  workspace,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, tube }
  }
})

const shoot = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// Where the bots stand, over a moment: a bot hops at idle, so a single frame
// can catch one in the air. The lowest its drawing reaches is where it rests.
const RESTING_FEET = `(async () => {
  const feet = (canvas) => {
    if (!canvas || canvas.width === 0) return null
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let row = canvas.height - 1; row >= 0; row -= 1) {
      for (let col = 0; col < canvas.width; col += 1) {
        if (data[(row * canvas.width + col) * 4 + 3] > 40) {
          const r = canvas.getBoundingClientRect()
          return r.top + ((row + 1) * r.height) / canvas.height
        }
      }
    }
    return null
  }
  const lowest = {}
  for (let frame = 0; frame < 8; frame += 1) {
    for (const bot of document.querySelectorAll('.lc-cover__face .lc-bot')) {
      const at = feet(bot.querySelector('canvas'))
      const name = bot.getAttribute('data-bot')
      if (at !== null && (lowest[name] === undefined || at > lowest[name])) lowest[name] = at
    }
    await new Promise((r) => setTimeout(r, 220))
  }
  return JSON.stringify(lowest)
})()`

const MEASURE = `(async () => {
  const card = document.querySelector('.lc-cover')
  const pane = document.querySelector('.lc-empty')
  if (!card || !pane) return JSON.stringify({ missing: true })
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, mid: (r.left + r.right) / 2 } }
  const lockup = card.querySelector('.lc-lockup')
  const mark = card.querySelector('.lc-lockup__mark')
  const name = card.querySelector('.lc-lockup__name')
  const claim = card.querySelector('.lc-cover__claim')
  // A2 (0.295): the machine -- the boot screen's bezel and glass -- with the
  // lockup and claim on the glass and the teammates standing on the bezel.
  const machine = card.querySelector('.lc-cover__machine')
  const glass = card.querySelector('.lc-cover__glass')
  // The letters' own extent, not the element's: a text range's box still
  // carries the tracking after the last letter, so that is taken off.
  const cs = (el) => getComputedStyle(el)
  const ink = (el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const r = range.getBoundingClientRect()
    const trail = parseFloat(cs(el).letterSpacing) || 0
    return { left: r.left, right: r.right - trail, width: r.width - trail }
  }
  const letters = ink(claim)
  const nameLetters = ink(name)
  // Where a bot's drawing ends, not its box: the canvas is half again the box
  // and a Locust's legs reach below it. The lowest row with ink, in page px.
  const feet = (canvas) => {
    if (!canvas || canvas.width === 0) return null
    const context = canvas.getContext('2d')
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let row = canvas.height - 1; row >= 0; row -= 1) {
      for (let col = 0; col < canvas.width; col += 1) {
        if (data[(row * canvas.width + col) * 4 + 3] > 40) {
          const r = canvas.getBoundingClientRect()
          return r.top + ((row + 1) * r.height) / canvas.height
        }
      }
    }
    return null
  }
  const faces = [...card.querySelectorAll('.lc-cover__face .lc-bot')].map((bot) => ({ bot: bot.getAttribute('data-bot'), state: bot.getAttribute('data-state'), width: Math.round(bot.getBoundingClientRect().width), feet: feet(bot.querySelector('canvas')), canvas: bot.querySelector('canvas')?.width ?? 0 }))
  return JSON.stringify({
    k: card.style.getPropertyValue('--lc-cover-k'),
    card: box(card), pane: box(pane), lockup: box(lockup), mark: box(mark), machine: box(machine), glass: box(glass), claim: box(claim),
    lockupInk: { left: box(mark).left, right: nameLetters.right, mid: (box(mark).left + nameLetters.right) / 2 },
    claimLetters: { left: letters.left, right: letters.right, mid: (letters.left + letters.right) / 2, width: letters.width },
    claimFont: { size: cs(claim).fontSize, family: cs(claim).fontFamily.split(',')[0], tracking: cs(claim).letterSpacing, transform: cs(claim).textTransform },
    nameFont: { size: cs(name).fontSize, family: cs(name).fontFamily.split(',')[0], weight: cs(name).fontWeight, tracking: cs(name).letterSpacing },
    fontsReady: { figtree700: document.fonts.check('700 46px Figtree'), geistMono: document.fonts.check('11px "Geist Mono"') },
    faces,
    scrolled: { top: pane.scrollTop, overflow: pane.scrollHeight - pane.clientHeight }
  })
})()`

try {
  // Watch from the first moment: probing or ready, the faces, the lockup.
  await drive.evaluate(`(() => {
    const log = []
    const t0 = performance.now()
    let last = ''
    const tick = () => {
      const lockup = document.querySelector('.lc-lockup')
      const faces = [...document.querySelectorAll('.lc-cover__face .lc-bot')].map((b) => b.getAttribute('data-state')).join(',') || 'nofaces'
      const dots = document.querySelectorAll('.lc-cover .lc-presence').length
      const state = [
        document.hasFocus() ? 'focus' : 'nofocus',
        document.querySelector('.lc-intro') ? 'ready' : 'probing',
        faces + ' dots=' + dots,
        lockup ? (lockup.className.match(/is-(powering|relighting)/)?.[0] ?? 'still') : 'nolockup'
      ].join(' | ')
      if (state !== last) { log.push(Math.round(performance.now() - t0) + ' ' + state); last = state }
    }
    window.__coverLog = log
    window.__coverTimer = setInterval(tick, 30)
    tick()
    return 'watching'
  })()`)

  let shotProbing = false
  let shotPower = false
  let shotRelight = false
  for (let i = 0; i < (tube === 'full' ? 800 : 300); i += 1) {
    await sleep(30)
    const state = JSON.parse(await drive.evaluate(`JSON.stringify({ cls: document.querySelector('.lc-lockup')?.className ?? '', ready: !!document.querySelector('.lc-intro'), cover: !!document.querySelector('.lc-cover') })`) ?? '{}')
    if (!shotProbing && state.cover && !state.ready) {
      shotProbing = true
      // Behind the loading screen the window is hidden, and a capture of a
      // hidden window waits until it is shown -- which is the moment the
      // lockup starts lighting from dark. With --tube off there is no
      // loading screen, and this is the probing screen a person sees.
      await shoot('00-probing.png')
      say('at the first frame: ' + (await drive.evaluate(`JSON.stringify({ visible: document.visibilityState, focus: document.hasFocus(), lockupOpacity: getComputedStyle(document.querySelector('.lc-lockup')).opacity, lockupBox: Math.round(document.querySelector('.lc-lockup').getBoundingClientRect().width), fonts: document.fonts.status, figtree: document.fonts.check('700 46px Figtree') })`)))
    }
    if (!shotPower && /is-powering/.test(state.cls ?? '')) {
      shotPower = true
      await sleep(450); await shoot('01-lit.png')
      await sleep(600); await shoot('02-sweep.png')
      await sleep(1900); await shoot('03-settled.png')
    }
    if (shotPower && !shotRelight && /is-relighting/.test(state.cls ?? '')) {
      shotRelight = true
      await sleep(500); await shoot('04-relit.png')
    }
    if (shotRelight) break
  }
  await sleep(2500)
  const log = JSON.parse((await drive.evaluate(`(clearInterval(window.__coverTimer), JSON.stringify(window.__coverLog))`)) ?? '[]')
  say('timeline (ms from the watch starting: focus | probing | faces + presence dots | lockup):')
  for (const line of log) say(`   ${line}`)
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify(log, null, 2), 'utf8')

  const probingLines = log.filter((line) => line.includes('| probing |'))
  const readyLines = log.filter((line) => line.includes('| ready |'))
  if (probingLines.length > 0) check('while probing, the teammates are still and dotless', probingLines.every((line) => /still,still,still dots=0/.test(line) || /nofaces/.test(line)), probingLines.join(' / '))
  else say('  note  probing finished before the watch began; the before-state was not seen on screen')
  check('once ready, Wren (a white ghost) floats, Atlas waits on you, Sable (a green Locust) sleeps', readyLines.some((line) => /default,default,sleeping dots=2/.test(line)), readyLines.slice(-1)[0])
  if (tube === 'full') check('the lockup lit, and lit again', shotPower && shotRelight)
  else check(`tube ${tube}: the lockup never lit`, !shotPower && !shotRelight)

  const sizes = [
    ['drive', undefined],
    ['1120x720', [1120, 720]],
    ['1920x1080', [1920, 1080]]
  ]
  const measured = {}
  for (const [label, size] of sizes) {
    if (size !== undefined) {
      await drive.resize(size[0], size[1])
      await sleep(900)
    }
    const m = JSON.parse(await drive.evaluate(MEASURE))
    const resting = JSON.parse(await drive.evaluate(RESTING_FEET))
    if (!m.missing) m.faces = m.faces.map((face) => ({ ...face, feet: resting[face.bot] ?? face.feet }))
    measured[label] = m
    await shoot(`size-${label}.png`)
    if (m.missing) { check(`${label}: the cover is on the home screen`, false); continue }
    say(`${label}: card ${Math.round(m.card.width)}x${Math.round(m.card.height)} at k=${m.k}; bots ${m.faces.map((f) => `${f.bot} ${f.width}px (canvas ${f.canvas})`).join(', ')}; claim ${m.claimFont.size} ${m.claimFont.family} ${m.claimFont.tracking}; name ${m.nameFont.size} ${m.nameFont.family} ${m.nameFont.weight}; pane overflow ${Math.round(m.scrolled.overflow)}px, scrolled ${Math.round(m.scrolled.top)}px`)
    // The machine cover has no card border, so its width is the cover's.
    // Since 0.351 the drawing grows into spare height (coverGrowFor): at most
    // 1.45x the card's share of 960, keeping 3% of the card clear each side.
    // And since 0.401 it gives height back on a page too tall for its pane,
    // down to COVER_MIN_GROW (0.85) -- this check still asked for "never
    // smaller" and failed on every full Home since (found 0.562; the same on
    // 0.561's packaged build). The range is the documented one; the k on the
    // page must still be the card's share times a factor inside it.
    const grown = Number(m.k) / (m.card.width / 960)
    check(`${label}: k is the card's width over the cover's 960, grown or given back within 0.85-1.45x`, grown >= 0.848 && grown <= 1.452, `${m.k} = ${(m.card.width / 960).toFixed(3)} x ${grown.toFixed(3)}`)
    check(`${label}: grown, the machine keeps 3% of the card clear each side`, m.machine.left - m.card.left >= 0.03 * m.card.width - 1 && m.card.right - m.machine.right >= 0.03 * m.card.width - 1, `${Math.round(m.machine.left - m.card.left)}px and ${Math.round(m.card.right - m.machine.right)}px of ${Math.round(m.card.width)}`)
    check(`${label}: the claim is centred under the lockup (letters to letters)`, Math.abs(m.claimLetters.mid - m.lockupInk.mid) <= 1.5, `claim centre ${m.claimLetters.mid.toFixed(1)}, lockup centre ${m.lockupInk.mid.toFixed(1)}`)
    check(`${label}: the lockup is centred on the machine's glass`, Math.abs(m.lockupInk.mid - m.glass.mid) <= 3, `lockup centre ${m.lockupInk.mid.toFixed(1)}, glass centre ${m.glass.mid.toFixed(1)}`)
    check(`${label}: the claim is on the glass, under the lockup`, m.claim.top >= m.glass.top && m.claim.bottom <= m.glass.bottom && m.claim.top > m.lockup.bottom, `claim ${Math.round(m.claim.top)}-${Math.round(m.claim.bottom)}, glass ${Math.round(m.glass.top)}-${Math.round(m.glass.bottom)}`)
    check(`${label}: the machine is centred on the card`, Math.abs(m.machine.mid - m.card.mid) <= 2, `machine ${m.machine.mid.toFixed(1)}, card ${m.card.mid.toFixed(1)}`)
    // The droid and the Locust stand on the bezel's top edge; the ghost floats.
    const standing = m.faces.filter((face) => face.bot !== 'ghost')
    check(`${label}: the teammates stand on the machine (their lowest drawn pixel at the bezel's top)`, standing.length === 2 && standing.every((face) => face.feet !== null && Math.abs(face.feet - m.machine.top) <= 8 * Math.max(1, Number(m.k))), standing.map((face) => `${face.bot} ${face.feet === null ? 'no ink' : Math.round(face.feet - m.machine.top) + 'px'}`).join(', '))
    check(`${label}: the claim is Geist Mono capitals, the name Figtree 700`, /Geist Mono/.test(m.claimFont.family) && m.claimFont.transform === 'uppercase' && /Figtree/.test(m.nameFont.family) && m.nameFont.weight === '700', JSON.stringify({ claim: m.claimFont, name: m.nameFont }))
    check(`${label}: both faces are loaded, not fallbacks`, m.fontsReady.figtree700 && m.fontsReady.geistMono, JSON.stringify(m.fontsReady))
    check(`${label}: the claim is never under 10.5px`, parseFloat(m.claimFont.size) >= 10.5, m.claimFont.size)
  }
  await writeFile(join(OUT, 'measured.json'), JSON.stringify(measured, null, 2), 'utf8')
  say(failures === 0 ? '\nHOME COVER PASSED' : `\nHOME COVER: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The home screen is the design system cover, as a machine (A2).' })
}
