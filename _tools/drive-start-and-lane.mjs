// Where a new profile starts, and which builds it takes.
//
//   node _tools/drive-start-and-lane.mjs --packaged <exe> [--tag <name>]
//
// Colin, 2026-09-23, on the beta's pitch ("full model control in a great UI,
// not free. Most users will be on Claude or Codex plans"): a new profile
// starts on Claude Code if it is signed in, then Codex, then OpenCode free --
// "will run with your default setup". And the beta handover: testers get one
// new build a day (Settings > Updates, "every build" off), whoever asks gets
// every build. Also the Network line in Privacy & local data, which said
// only what the window does.
//
// A fresh profile, nothing seeded but an empty roster; sends nothing. The
// update service is on only in a packaged build, so run this on one.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'packaged'
if (packaged === undefined) throw new Error('run this on a packaged build: --packaged <Locust.exe>')
const OUT = join(new URL('../docs/beta-fixes-2026-09-23/', import.meta.url).pathname.slice(1), `start-and-lane-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-start-lane-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-start-lane-profile-'))
const drive = await startDrive({
  name: `start-and-lane-${tag}`,
  port: 9507,
  workspace,
  outPath: OUT,
  profilePath,
  packaged,
  sendsNothing: true,
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  await drive.resize(1215, 800)
  // The route settles once discovery has answered for every runtime.
  let route = ''
  for (let waited = 0; waited < 60_000; waited += 1000) {
    route = String(await drive.evaluate(`(() => ([...document.querySelectorAll('button.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ').trim())()`))
    if (route.length > 0 && !/checking/i.test(route)) break
    await sleep(1000)
  }
  await sleep(4000)
  route = String(await drive.capture('a fresh profile: where the composer starts', () => drive.evaluate(`(() => ([...document.querySelectorAll('button.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ').trim())()`)))
  const runtimes = String(await drive.evaluate(`(() => [...document.querySelectorAll('.lc-runtimecell, .lc-agentrow, [data-runtime]')].map((el) => (el.textContent ?? '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 10).join(' | '))()`))
  say(`route: ${route}`)
  say(`runtimes: ${runtimes.slice(0, 400)}`)
  check('a fresh profile starts on Claude Code, which is signed in here', /^Claude/i.test(route) && !/OpenCode/i.test(route), route)

  const settings = await drive.capture('Settings, Updates: the lane switch', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^General$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 1000))
    const toggle = document.querySelector('button[role="switch"][aria-label="Beta builds"]')
    const note = toggle?.closest('.lc-settingrow')?.querySelector('.lc-settings__note')?.textContent ?? null
    const network = [...document.querySelectorAll('dt')].find((dt) => dt.textContent.trim() === 'Network')?.nextElementSibling?.textContent?.replace(/\\s+/g, ' ').trim() ?? null
    return JSON.stringify({ switch: toggle === null ? null : toggle.getAttribute('aria-checked'), note, network })
  })()`))
  const before = JSON.parse(String(settings))
  // Its words: "Beta builds" since 0.311 (Colin: "wayyy too wordy"); 0.310 said
  // "New versions as they are released"; 0.307-0.309 "One new build a day",
  // untrue once every verified build was the release.
  check('Settings > Updates has the lane switch, off: releases', before.switch === 'false' && /^(Beta builds|New versions as they are released|One new build a day)/.test(before.note ?? ''), String(settings))
  check('the Network line names what Locust itself fetches', /checks for and downloads its own updates, and new Codex CLI and Copilot CLI versions/.test(before.network ?? ''), JSON.stringify(before.network))

  const flipped = await drive.capture('the switch turned on: every build', () => drive.evaluate(`(async () => {
    document.querySelector('button[role="switch"][aria-label="Beta builds"]')?.click()
    await new Promise((r) => setTimeout(r, 4000))
    const toggle = document.querySelector('button[role="switch"][aria-label="Beta builds"]')
    return JSON.stringify({ switch: toggle?.getAttribute('aria-checked') ?? null, note: toggle?.closest('.lc-settingrow')?.querySelector('.lc-settings__note')?.textContent ?? null })
  })()`))
  const after = JSON.parse(String(flipped))
  check('turned on, it says test builds too', after.switch === 'true' && /^(Beta builds|Test builds too, as soon as they are out|Every build, as soon as it is out)/.test(after.note ?? ''), String(flipped))
  const saved = join(profilePath, 'update-lane.json')
  const lane = existsSync(saved) ? readFileSync(saved, 'utf8') : '(no file)'
  check('and the choice is saved in the profile', /"everyBuild":true/.test(lane), lane)
  say(failures === 0 ? '\nSTART AND LANE PASSED' : `\nSTART AND LANE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'A fresh profile: where the composer starts; Settings > Updates, the lane switch off then on; the Network line. Sends nothing.' })
}
