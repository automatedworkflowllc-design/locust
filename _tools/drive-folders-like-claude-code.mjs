// Folders like Claude Code (0.458): switch folders without a restart, every
// folder's conversations in the sidebar, each conversation in its own folder.
//
//   node _tools/drive-folders-like-claude-code.mjs [--packaged <exe>]
//
// Colin, 2026-09-29: switching to a testing worktree "crashed the app, and
// reset all my teammates" -- the switch was a restart, and the sidebar then
// listed only the new folder's conversations. "Just make it work exactly like
// Claude code."
//
// Two scratch projects, Alpha and Beta, both already known to Locust. Ash (the
// free OpenCode model) writes a file in Alpha; the folder chip switches the
// window to Beta -- the SAME process, and the page never reloads -- and Ash
// writes a file in Beta; the sidebar lists both projects; opening Alpha's
// conversation puts the window back in Alpha, and a follow-up there writes its
// file in Alpha, not Beta. Every file is read from disk.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const alpha = await scratchRepository('locust-drive-alpha-')
const beta = await scratchRepository('locust-drive-beta-')
const idOf = (path) => `ws_${createHash('sha256').update(path, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'folders-like-claude-code', port: 9657, workspace: alpha, launchElsewhere: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  },
  files: {
    'folders.json': {
      schemaVersion: 1,
      folders: [
        { id: idOf(alpha), path: alpha, name: basename(alpha), lastUsedAt: '2026-09-29T01:00:00.000Z' },
        { id: idOf(beta), path: beta, name: basename(beta), lastUsedAt: '2026-09-29T00:00:00.000Z' }
      ]
    }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const chip = () => drive.evaluate(`document.querySelector('.lc-control--folder .lc-control__folder')?.textContent ?? ''`)
const pageBorn = () => drive.evaluate('String(performance.timeOrigin)')
const pid = drive.pid

try {
  await drive.capture('launch in Alpha', () => drive.ready())
  await drive.resize(1440, 900)
  await drive.evaluate(openTeammateScript('Ash'))
  const born = await pageBorn()
  const first = String(await drive.capture('in Alpha: Ash writes alpha.txt', () => drive.evaluate(sendAndWaitScript('Create a file named alpha.txt in this folder containing exactly the word ALPHA. Then reply with the single word DONE.'))))
  check('Alpha\'s conversation wrote alpha.txt in Alpha', existsSync(join(alpha, 'alpha.txt')) && !existsSync(join(beta, 'alpha.txt')), first.slice(-80))

  const switched = JSON.parse(String(await drive.capture('the folder chip: switch to Beta', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-control--folder')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('.lc-menu[aria-label="Work in folder"] .lc-menu__item')].map((item) => item.querySelector('.lc-menu__name')?.textContent ?? '')
    const target = [...document.querySelectorAll('.lc-menu[aria-label="Work in folder"] .lc-menu__item')].find((item) => item.querySelector('.lc-menu__name')?.textContent === ${JSON.stringify(basename(beta))})
    target?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return JSON.stringify({ items, clicked: !!target })
  })()`))))
  check('the chip offers the known folders and "Choose a folder..."', switched.clicked && switched.items.includes(basename(alpha)) && switched.items.includes('Choose a folder...'), JSON.stringify(switched.items))
  check('the switch is in place: same process, and the page never reloaded', drive.pid === pid && (await pageBorn()) === born, `pid ${String(drive.pid)} / ${String(pid)}`)
  check('the chip now names Beta', (await chip()) === basename(beta), await chip())

  const second = String(await drive.capture('in Beta: Ash writes beta.txt, in a new conversation', () => drive.evaluate(sendAndWaitScript('Create a file named beta.txt in this folder containing exactly the word BETA. Then reply with the single word DONE.'))))
  check('Beta\'s conversation wrote beta.txt in Beta', existsSync(join(beta, 'beta.txt')) && !existsSync(join(alpha, 'beta.txt')), second.slice(-80))

  const sidebar = JSON.parse(String(await drive.capture('the sidebar: both projects, each with its conversation', () => drive.evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify([...document.querySelectorAll('.lc-project')].map((project) => ({
      name: project.querySelector('.lc-project__name')?.textContent ?? '',
      current: project.querySelector('.lc-project__head')?.classList.contains('is-current') ?? false,
      rows: project.querySelectorAll('.lc-convrow').length,
      count: Number(project.querySelector('.lc-sectionlabel__count')?.textContent ?? '0'),
      open: project.querySelector('.lc-project__head')?.getAttribute('aria-expanded') === 'true'
    })))
  })()`))))
  const names = sidebar.map((project) => project.name)
  check('the sidebar lists both projects: Beta (the window\'s) first and open, Alpha folded with its count', names[0] === basename(beta) && names.includes(basename(alpha)) && sidebar[0].current === true && sidebar[0].open === true && sidebar[0].rows === 1 && sidebar[1]?.open === false && sidebar[1]?.count === 1, JSON.stringify(sidebar))

  const reopened = String(await drive.capture('open Alpha\'s conversation from the sidebar', () => drive.evaluate(`(async () => {
    const project = [...document.querySelectorAll('.lc-project')].find((one) => one.querySelector('.lc-project__name')?.textContent === ${JSON.stringify(basename(alpha))})
    // Another folder starts folded: unfold it, as a person would.
    project?.querySelector('.lc-project__head')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const row = project?.querySelector('.lc-convrow button.lc-conv')
    row?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return document.querySelector('.lc-control--folder .lc-control__folder')?.textContent ?? ''
  })()`)))
  check('opening it puts the window back in Alpha', reopened === basename(alpha), reopened)
  const third = String(await drive.capture('a follow-up in Alpha\'s conversation writes gamma.txt', () => drive.evaluate(sendAndWaitScript('Now also create gamma.txt in this folder containing exactly the word GAMMA. Then reply with the single word DONE.'))))
  check('the follow-up wrote gamma.txt in Alpha, not Beta', existsSync(join(alpha, 'gamma.txt')) && !existsSync(join(beta, 'gamma.txt')), third.slice(-80))
  check('still the same process, still never reloaded', drive.pid === pid && (await pageBorn()) === born)
  const kept = JSON.parse(await readFile(join(drive.profile, 'folders.json'), 'utf8'))
  check('folders.json keeps both folders', kept.folders.length >= 2, JSON.stringify(kept.folders.map((folder) => folder.name)))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model; two scratch projects.`, extra: `Checks failed: ${String(failures)}` })
}
