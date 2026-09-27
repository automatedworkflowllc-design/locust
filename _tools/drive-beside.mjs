// Two conversations side by side (0.396, Orca's item 4).
//
//   node _tools/drive-beside.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only. Wren answers a one-word question; Sable starts counting
// to 150. With Wren in the middle, Sable's conversation is opened BESIDE it
// from its right-click menu:
//   1. the panel shows Sable's thread, and it is live -- the count grows in
//      the panel while the middle stays on Wren;
//   2. the chat box still addresses Wren, and the panel covers none of the
//      middle thread;
//   3. "Open it here" puts Sable in the middle and closes the panel.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('beside-2026-09-27'), `beside-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-beside-ws-')
const drive = await startDrive({
  name: `beside-${tag}`,
  port: 9699,
  workspace,
  outPath: OUT,
  launchElsewhere: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE },
      { teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const type = (text, wait) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (button && !button.disabled) { button.click(); break }
  }
  if (!${wait ? 'true' : 'false'}) return 'sent'
  for (let i = 0; i < 600; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
  }
  return 'timed out'
})()`)
const row = (who) => `[...document.querySelectorAll('.lc-conv')].find((entry) => entry.querySelector('[data-teammate="${who}"]'))`
const panelText = () => drive.evaluate(`document.querySelector('.lc-beside .lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`)

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(500)
  check('Wren answers', String(await type('Reply with exactly the word: ready.', true)) === 'ended')
  await drive.evaluate(`${teammateFace('Sable')}?.click()`)
  await sleep(500)
  await type('Count from 1 to 150, one number per line, and nothing else. Do not use any tools.', false)
  for (let i = 0; i < 60; i += 1) {
    if (String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'true') break
    await sleep(500)
  }
  // Wren in the middle, then Sable's conversation beside it.
  await drive.evaluate(`${row('tm_wren')}?.click()`)
  await sleep(800)
  const menu = String(await drive.evaluate(`(async () => {
    const target = ${row('tm_sable')}
    if (!target) return 'no Sable row'
    const box = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 40, clientY: box.top + 10 }))
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role=menuitem], .lc-menu button, .lc-contextmenu button')].find((entry) => /^Open beside/.test(entry.innerText.trim()))
    if (!item) return 'no Open beside item: ' + [...document.querySelectorAll('[role=menuitem]')].map((entry) => entry.innerText.trim()).join(' | ')
    item.click()
    await new Promise((r) => setTimeout(r, 900))
    return 'opened'
  })()`))
  check('"Open beside" is on the row’s menu', menu === 'opened', menu)
  const first = String(await drive.capture('Sable beside Wren', () => panelText()))
  check('the panel shows Sable’s conversation', /Count from 1 to 150/.test(first), first.slice(0, 120))
  // Live: Sable's numbers arrive IN THE PANEL while the middle stays on Wren.
  // Waited for, because a free model can take a while to say its first word.
  const answer = (text) => text.slice(text.indexOf('Do not use any tools.') + 21)
  let later = first
  for (let i = 0; i < 90 && !/\b1\b[\s\S]*\b2\b[\s\S]*\b3\b/.test(answer(later)); i += 1) {
    await sleep(1000)
    later = String(await panelText())
  }
  await drive.capture('Sable counting in the panel', () => later)
  const middleNow = String(await drive.evaluate(`document.querySelector('.lc-workroom .lc-thread')?.innerText ?? ''`))
  check('and it is live: Sable’s count arrives in the panel, not the middle', /\b1\b[\s\S]*\b2\b[\s\S]*\b3\b/.test(answer(later)) && !/Count from 1 to 150/.test(middleNow), answer(later).slice(0, 80))
  const layout = JSON.parse(String(await drive.evaluate(`JSON.stringify({
    composer: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? '',
    middle: document.querySelector('.lc-workroom .lc-thread')?.innerText.slice(0, 80) ?? '',
    middleRight: Math.round(document.querySelector('.lc-workroom')?.getBoundingClientRect().right ?? 0),
    panelLeft: Math.round(document.querySelector('.lc-beside')?.getBoundingClientRect().left ?? 0)
  })`)))
  check('the chat box still addresses Wren, and the middle is still Wren’s', /^Message Wren/.test(layout.composer) && /ready/.test(layout.middle), `${layout.composer} / ${layout.middle}`)
  check('the panel covers none of the middle', layout.panelLeft >= layout.middleRight - 1, `middle ends ${String(layout.middleRight)}, panel starts ${String(layout.panelLeft)}`)
  await drive.capture('"Open it here": Sable in the middle, the panel gone', async () => {
    await drive.evaluate(`document.querySelector('.lc-beside button[aria-label="Open it here"]')?.click()`)
    await sleep(900)
    return drive.evaluate(`document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? ''`)
  })
  const after = JSON.parse(String(await drive.evaluate(`JSON.stringify({ panel: document.querySelector('.lc-beside') !== null, composer: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? '' })`)))
  check('"Open it here" puts Sable in the middle and closes the panel', !after.panel && /Sable/.test(after.composer), JSON.stringify(after))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren and Sable on a free model; Sable's count opened beside Wren.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
