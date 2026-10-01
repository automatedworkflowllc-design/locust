// Every main screen, captured at Colin's window size, to be looked at (0.524).
//
//   node _tools/look-every-screen.mjs [--packaged <exe>] [--tag <name>]
//
// He finds defects by LOOKING at the packaged app. The everyday profile
// (sixteen conversations, four teammates) at 1209x770: Home, a conversation,
// Missions, Rooms, Routines, Team, and the Settings pages a person opens
// first. Nothing is checked here and nothing is sent: the pictures are read.

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const everyday = await seedEverydayLedger('look-every-screen')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `look-every-screen-${tag}`,
  port: 9847,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  outPath: join(recordRoot('look-every-screen-2026-10-01'), tag),
  seed: everyday.seed
})
const nav = (label) => `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button, .lc-sidebar button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('main, .lc-screen')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? ''
})()`
const settingsPage = (label) => `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})?.click()
  await new Promise((r) => setTimeout(r, 900))
  return 1
})()`

try {
  await drive.ready()
  await drive.resize(1209, 770)
  await sleep(2500)
  await drive.capture('Home', () => drive.evaluate('1'))
  await drive.capture('a conversation', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-convrow button.lc-conv')].find((r) => /login redirect/i.test(r.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return 1
  })()`))
  for (const screen of ['Missions', 'Rooms', 'Routines', 'Team']) await drive.capture(screen, () => drive.evaluate(nav(screen)))
  for (const page of ['General', 'AI agents', 'Teammates', 'Connectors', 'Project folder']) await drive.capture(`Settings ${page}`, () => drive.evaluate(settingsPage(page)))
  say('captured')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The everyday profile at 1209x770, every main screen, for looking at.`, extra: '' })
}
