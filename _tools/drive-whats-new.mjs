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
// Two launches:
//   1. from 0.276.0 -- 0.277.0 (every teammate is a bot) and 0.295.0 (the
//      title screen is a machine) are marked big, so Home shows the splash
//      once with both; "See every version" opens Settings on the Changelog
//      (What's new until 0.293); the version is then marked seen.
//   2. already on the running build -- nothing pops up, and no banner.
// Sends nothing.

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
// --out keeps a new run from writing over the 9/23 records, which are tracked.
const OUT = arg('--out') ?? join(recordRoot('whats-new-2026-09-23'), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/*
 * What the checks expect, READ FROM THE CHANGELOG this build ships rather than
 * written out. They were written out on 2026-09-23 -- "0.295.0,0.277.0", "the
 * newest is 0.295.0" -- and read FAIL on every later big build although
 * nothing was wrong (packaged 0.350, the design pass marked big).
 */
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const releases = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})\r?\n(<!-- big -->)?/gm)].map((match) => ({ version: match[1], date: match[2], big: match[3] !== undefined }))
const newer = (a, b) => { const [x, y] = [a, b].map((v) => v.split('.').map(Number)); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }
const BIG_SINCE_276 = releases.filter((release) => release.big && newer(release.version, '0.276.0') > 0).map((release) => release.version)
const NEWEST = releases[0].version
const inWords = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const NEWEST_BIG_DATE = inWords(releases.find((release) => release.big && release.version === BIG_SINCE_276[0]).date)
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
    check(`Home shows the splash for every big build since 0.276, newest first -- ${BIG_SINCE_276.join(', ')}`, splash.versions.join() === BIG_SINCE_276.join(), splash.versions.join())
    check("it reads like Claude Code's: a date in words and the version as a badge", splash.dates[0] === NEWEST_BIG_DATE, `${splash.dates.join()} (expected first: ${NEWEST_BIG_DATE})`)
    check('with the way to every version, and a way out', splash.buttons.includes('See every version') && splash.buttons.includes('Got it'), splash.buttons.join(' / '))
    check('and it fits the window', splash.fits)
    check('there is no banner on Home', !BANNER.test(await drive.evaluate('document.body.innerText')))
    await shoot('01-the-splash.png')

    await drive.evaluate(`([...document.querySelectorAll('.lc-whatsnew__splash button')].find((b) => b.innerText.trim() === 'See every version').click(), 'clicked')`)
    await drive.waitFor(`!!document.querySelector('.lc-whatsnew .lc-release')`, { timeoutMs: 10_000, what: 'Settings on the Changelog' })
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
    // The page is named "What's new" in the list since 0.393 (settingsPages.ts); its heading says Changelog.
    check('See every version opens Settings on the Changelog', /changelog|what.s new/i.test(page.current) && page.heading.some((h) => /changelog/i.test(h)) && page.splashGone, page.current)
    check(`newest first (${NEWEST}), twelve builds, grouped New / Improved / Fixed, with the older ones a press away`, page.builds === 12 && page.first === NEWEST && labels.includes('new') && labels.includes('improved') && labels.includes('fixed') && page.more, JSON.stringify({ builds: page.builds, first: page.first, labels: page.labels }))
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

// ---- 2. Already on the running build: nothing pops up. (Every update since
// 0.281 crosses a big build now, so there is no quiet update left to arrive by.)
{
  const running = JSON.parse(await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')).version
  const drive = await launch('whats-new-quiet', 9404, running)
  try {
    await drive.ready()
    await drive.resize(1120, 720)
    await sleep(2500)
    const quiet = JSON.parse(await drive.evaluate(`JSON.stringify({ splash: !!document.querySelector('.lc-whatsnew__splash'), banner: /is running\\. Here is what changed/.test(document.body.innerText) })`))
    check('nothing new since the build it is on, so nothing pops up -- and no banner either', !quiet.splash && !quiet.banner, JSON.stringify(quiet))
    const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) await writeFile(join(OUT, '04-a-quiet-update.png'), Buffer.from(shot.result.data, 'base64'))
    const seenNow = JSON.parse(await readFile(join(drive.profile, 'seen-version.json'), 'utf8').catch(() => '{}')).version
    check('and the version stays marked seen', seenNow === running, String(seenNow))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'Already on the running build: nothing pops up.' })
  }
}

say(failures === 0 ? '\nWHATS NEW PASSED' : `\nWHATS NEW: ${String(failures)} FAILED`)
