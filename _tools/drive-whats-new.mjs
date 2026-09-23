// What's new in Settings, the splash after a big update -- and no banner.
//
//   node _tools/drive-whats-new.mjs [--packaged <exe>]
//
// Colin, 2026-09-23, with a frame of Claude Code's What's new: "we can really
// get this and just introduce a proper changelog the way claude code does, if
// we have really good big updates where the user has to know things, we can
// have a splash page on update" -- and of the home banner, "it adds a
// needless scrollbar on that title menu". Replaces changelog-drive.mjs, which
// drove the banner.
//
// Two launches, each as someone updating from an older build:
//   1. from 0.276.0 -- 0.277.0 (every teammate is a bot) is marked big, so
//      Home shows the splash once; "See every version" opens Settings on
//      What's new; the version is then marked seen.
//   2. from 0.279.0 -- nothing big since, so nothing pops up, and no banner.
// Sends nothing.

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(new URL('../docs/whats-new-2026-09-23/', import.meta.url).pathname.slice(1), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const seed = { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
const BANNER = /is running\. Here is what changed/

const launch = async (name, port, seen) =>
  startDrive({
    name,
    port,
    workspace: await scratchRepository(`locust-drive-${name}-ws-`),
    sendsNothing: true,
    seed,
    files: { 'seen-version.json': JSON.stringify({ version: seen }) },
    ...(packaged === undefined ? {} : { packaged })
  })

// ---- 1. Arriving from 0.276.0: the splash.
{
  const drive = await launch('whats-new-splash', 9403, '0.276.0')
  const shoot = async (file) => {
    const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
  }
  try {
    await drive.ready()
    await drive.resize(1120, 720)
    await drive.waitFor(`!!document.querySelector('.lc-whatsnew__splash')`, { timeoutMs: 20_000, what: 'the splash' })
    const splash = JSON.parse(await drive.evaluate(`(() => {
      const box = document.querySelector('.lc-whatsnew__splash')
      return JSON.stringify({
        title: box.querySelector('.lc-dialog__title')?.innerText ?? '',
        versions: [...box.querySelectorAll('.lc-release__version')].map((el) => el.innerText.trim()),
        dates: [...box.querySelectorAll('.lc-release__date')].map((el) => el.innerText.trim()),
        text: box.innerText.slice(0, 400),
        buttons: [...box.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
        fits: box.getBoundingClientRect().bottom <= window.innerHeight
      })
    })()`))
    say(`splash: ${JSON.stringify(splash).slice(0, 500)}`)
    check('Home shows the splash for the big build since 0.276 -- the bots, and only it', splash.versions.join() === '0.277.0' && /Every teammate is a bot/.test(splash.text), splash.versions.join())
    check("it reads like Claude Code's: a date in words and the version as a badge", splash.dates[0] === 'September 22, 2026', splash.dates.join())
    check('with the way to every version, and a way out', splash.buttons.includes('See every version') && splash.buttons.includes('Got it'), splash.buttons.join(' / '))
    check('and it fits the window', splash.fits)
    check('there is no banner on Home', !BANNER.test(await drive.evaluate('document.body.innerText')))
    await shoot('01-the-splash.png')

    await drive.evaluate(`([...document.querySelectorAll('.lc-whatsnew__splash button')].find((b) => b.innerText.trim() === 'See every version').click(), 'clicked')`)
    await drive.waitFor(`!!document.querySelector('.lc-whatsnew .lc-release')`, { timeoutMs: 10_000, what: "Settings on What's new" })
    const page = JSON.parse(await drive.evaluate(`(() => JSON.stringify({
      current: document.querySelector('.lc-settings__navitem.is-current')?.innerText.trim() ?? '',
      heading: [...document.querySelectorAll('.lc-settings__heading')].map((el) => el.innerText.trim()),
      builds: document.querySelectorAll('.lc-whatsnew .lc-release').length,
      first: document.querySelector('.lc-whatsnew .lc-release__version')?.innerText.trim() ?? '',
      labels: [...new Set([...document.querySelectorAll('.lc-whatsnew .lc-release__label')].map((el) => el.innerText.trim()))],
      more: !!document.querySelector('.lc-whatsnew__more'),
      splashGone: !document.querySelector('.lc-whatsnew__splash')
    }))()`))
    say(`what's new: ${JSON.stringify(page)}`)
    // innerText is the text as drawn, and the headings and labels are set in
    // spaced capitals: compare without case.
    const labels = page.labels.map((label) => label.toLowerCase())
    check("See every version opens Settings on What's new", /what.s new/i.test(page.current) && page.heading.some((h) => /what.s new/i.test(h)) && page.splashGone, page.current)
    check('newest first, twelve builds, grouped New / Improved / Fixed, with the older ones a press away', page.builds === 12 && page.first === '0.281.0' && labels.includes('new') && labels.includes('improved') && labels.includes('fixed') && page.more, JSON.stringify({ builds: page.builds, first: page.first, labels: page.labels }))
    await shoot('02-whats-new.png')
    await drive.evaluate(`(document.querySelector('.lc-whatsnew__more').click(), 'more')`)
    await sleep(400)
    const more = Number(await drive.evaluate(`document.querySelectorAll('.lc-whatsnew .lc-release').length`))
    check('Show older versions adds thirty more', more === 42, String(more))
    await drive.evaluate(`(document.querySelector('.lc-whatsnew .lc-release[data-version="0.43.6"]') ?? document.querySelectorAll('.lc-whatsnew .lc-release')[20]).scrollIntoView({ block: 'center' }), 'scrolled'`)
    await sleep(300)
    await shoot('03-older-builds.png')
    const seenNow = JSON.parse(await readFile(join(drive.profile, 'seen-version.json'), 'utf8').catch(() => '{}')).version
    check('and the version is marked seen, so it never shows again', typeof seenNow === 'string' && seenNow !== '0.276.0', String(seenNow))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'Arriving from 0.276.0: the splash, then What’s new.' })
  }
}

// ---- 2. Arriving from 0.279.0: nothing pops up.
{
  const drive = await launch('whats-new-quiet', 9404, '0.279.0')
  try {
    await drive.ready()
    await drive.resize(1120, 720)
    await sleep(2500)
    const quiet = JSON.parse(await drive.evaluate(`JSON.stringify({ splash: !!document.querySelector('.lc-whatsnew__splash'), banner: /is running\\. Here is what changed/.test(document.body.innerText) })`))
    check('nothing big since 0.279, so nothing pops up -- and no banner either', !quiet.splash && !quiet.banner, JSON.stringify(quiet))
    const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) await writeFile(join(OUT, '04-a-quiet-update.png'), Buffer.from(shot.result.data, 'base64'))
    const seenNow = JSON.parse(await readFile(join(drive.profile, 'seen-version.json'), 'utf8').catch(() => '{}')).version
    check('the quiet update is still marked seen', typeof seenNow === 'string' && seenNow !== '0.279.0', String(seenNow))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'Arriving from 0.279.0: a quiet update.' })
  }
}

say(failures === 0 ? '\nWHATS NEW PASSED' : `\nWHATS NEW: ${String(failures)} FAILED`)
