// Do the two update lanes offer what they should, from the real release channel?
//
//   node _tools/drive-update-lane.mjs --packaged <an older Locust.exe> --expect-latest <v> --expect-every <v> [--tag <name>]
//
// The beta handover: testers get at most one new build a day. Since 0.307
// every build is a GitHub prerelease and one a day is promoted to latest
// (_tools/promote-release.mjs); Settings > Updates' "every build" switch is
// electron-updater's allowPrerelease (update-lane.ts). Run an OLDER build:
// on the tester lane its check must find only latest; switched to every
// build, the newest prerelease.
//
// Its own LOCALAPPDATA: electron-updater keeps its download cache there,
// under the app's name, shared with an installed Locust -- a download here
// must never land in the installed copy's pending folder. Sends nothing.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const expectLatest = arg('--expect-latest')
const expectEvery = arg('--expect-every')
const tag = arg('--tag') ?? 'packaged'
if (packaged === undefined || expectLatest === undefined || expectEvery === undefined) {
  throw new Error('usage: --packaged <Locust.exe> --expect-latest <version> --expect-every <version>')
}
const OUT = join(new URL('../docs/beta-fixes-2026-09-23/', import.meta.url).pathname.slice(1), `update-lane-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-update-lane-ws-')
const localAppData = await mkdtemp(join(tmpdir(), 'locust-update-lane-local-'))
const drive = await startDrive({
  name: `update-lane-${tag}`,
  port: 9513,
  workspace,
  outPath: OUT,
  packaged,
  sendsNothing: true,
  env: { LOCALAPPDATA: localAppData },
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// The Updates section's own line, after it settles.
const LINE = `(async () => {
  for (let i = 0; i < 240; i += 1) {
    const section = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'Updates')
    const text = (section?.innerText ?? '').replace(/\\s+/g, ' ')
    if (/Up to date\\.|ready to install|could not complete/i.test(text)) return text.slice(0, 400)
    await new Promise((r) => setTimeout(r, 500))
  }
  return 'NO ANSWER in two minutes'
})()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^General$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 1000))
  })()`)
  const version = String(await drive.evaluate(`(document.body.innerText.match(/This is (\\d+\\.\\d+\\.\\d+)/) ?? [])[1] ?? '?'`))
  say(`this build: ${version}`)

  // The tester lane: a check finds only latest.
  const tester = await drive.capture('the tester lane: Check now', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find((b) => /^Check now$|^Check again$/.test(b.textContent.trim()))
    button?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return ${LINE}
  })()`))
  const testerSees = String(tester)
  const testerOk = expectLatest === version ? /Up to date\./.test(testerSees) : new RegExp(`${expectLatest.replace(/\./g, '[.]')}`).test(testerSees)
  check(`the tester lane offers only latest (${expectLatest})`, testerOk && !new RegExp(expectEvery.replace(/\./g, '[.]')).test(testerSees), testerSees.slice(0, 200))

  // Every build: the switch re-checks at once, and finds the newest prerelease.
  const every = await drive.capture('every build: the newest prerelease', () => drive.evaluate(`(async () => {
    document.querySelector('button[role="switch"][aria-label="Take every build as soon as it is out"]')?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return ${LINE}
  })()`))
  const everySees = String(every)
  check(`every build offers the newest prerelease (${expectEvery})`, new RegExp(`${expectEvery.replace(/\./g, '[.]')}`).test(everySees) && /ready to install/.test(everySees), everySees.slice(0, 200))
  say(failures === 0 ? '\nUPDATE LANE PASSED' : `\nUPDATE LANE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'An older build, its own update cache: the tester lane checks and finds latest; every build, switched on, finds the newest prerelease. Sends nothing.' })
  await sleep(500)
}
