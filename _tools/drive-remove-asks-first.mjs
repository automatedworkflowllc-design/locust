// Does the Team screen's x ask before it removes a teammate (H2)?
//
//   node _tools/drive-remove-asks-first.mjs [--packaged <exe>] [--tag <name>]
//
// The code review's H2: the x beside a teammate's pencil removed them -- and
// their routines, conversations' ownership and any room left empty -- on the
// first click, while the right-click Remove asked. With the real mouse: one
// press must only arm it; a double-click must only arm it (M34); a second,
// separate press removes them. Sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `remove-asks-first-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  name: 'remove-asks-first',
  port: 9555,
  workspace: await scratchRepository('locust-drive-armed-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0 },
      { teammateId: 'tm_ash', name: 'Ash', hue: 'blue', role: 'Docs & QA', createdAt: T0 }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const mouse = (type, x, y, clickCount = 1) => drive.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount })
const click = async (x, y, clickCount = 1) => {
  await mouse('mousePressed', x, y, clickCount)
  await mouse('mouseReleased', x, y, clickCount)
}
const STATE = `(() => {
  const x = [...document.querySelectorAll('.lc-rostercard__remove')].find((b) => /Wren/.test(b.getAttribute('aria-label') ?? '') || /Wren/.test(b.closest('[class*="rostercard"]')?.textContent ?? ''))
  const names = [...document.querySelectorAll('.lc-rostercard')].map((card) => card.textContent)
  const box = x?.getBoundingClientRect()
  return JSON.stringify({
    wren: names.some((text) => /Wren/.test(text)),
    label: x?.getAttribute('aria-label') ?? null,
    at: box === undefined ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })
})()`
const state = async () => JSON.parse(String(await drive.evaluate(STATE)))

try {
  await drive.capture('launch: Wren and Ash', () => drive.ready())
  await drive.resize(1215, 800)
  await drive.capture('the Team screen', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => /^\\s*Team\\s*$/.test(b.textContent))?.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      if (document.querySelector('.lc-rostercard__remove')) return 'team open'
    }
    return 'no team screen'
  })()`))
  const first = await state()
  check('Wren is on the Team screen, with an x', first.wren && first.at !== null, JSON.stringify(first))

  await click(first.at.x, first.at.y)
  await sleep(500)
  const armed = await state()
  await drive.capture('one press on the x', () => drive.evaluate(STATE))
  check('one press does not remove Wren', armed.wren === true)
  check('it asks instead', armed.label === 'Remove Wren?', String(armed.label))

  // Disarm (focus elsewhere), then a double-click from rest.
  await drive.evaluate(`document.activeElement?.blur()`)
  await sleep(400)
  const rest = await state()
  await click(rest.at.x, rest.at.y, 1)
  await sleep(60)
  await click(rest.at.x, rest.at.y, 2)
  await sleep(700)
  const doubled = await state()
  await drive.capture('a double-click on the x', () => drive.evaluate(STATE))
  check('a double-click does not remove Wren either', doubled.wren === true, JSON.stringify(doubled))

  // A second, separate press on the armed x.
  await click(doubled.at.x, doubled.at.y)
  await sleep(1200)
  const gone = await state()
  await drive.capture('a second, separate press', () => drive.evaluate(STATE))
  check('a second press removes Wren', gone.wren === false, JSON.stringify(gone))
  say(failures === 0 ? '\nREMOVE ASKS FIRST PASSED' : `\nREMOVE ASKS FIRST: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Ash; the Team screen's x on Wren, pressed with the real mouse.` })
}
