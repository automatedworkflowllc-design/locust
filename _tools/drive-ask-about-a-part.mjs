// Select part of a reply, press "Ask about this": the part is quoted into the message box (0.475).
//
//   node _tools/drive-ask-about-a-part.mjs [--packaged <exe>] [--tag <name>]
//
// A tester's feedback, 2026-09-29 (issue #1, on 0.474): "I can't select a
// specific part of the chat to follow up on like I do using chatgpt". Built
// in 0.475 (SelectionAsk) and never driven. A real mouse drag across words of
// a reply, as a person selects; the button; the quote in the box. Free model.

import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-ask-part-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `ask-about-a-part-${tag}`,
  port: 9825,
  workspace,
  outPath: join(recordRoot('ask-about-a-part-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}
const mouse = (type, x, y, extra = {}) => drive.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.capture('a reply to select from', () => drive.evaluate(sendAndWaitScript('Reply with exactly these three sentences and nothing else: The river is wide. The bridge is old. The town is quiet.')))
  // Where "The bridge is old" sits on screen, from the reply's own text.
  const at = JSON.parse(String(await drive.evaluate(`(() => {
    const body = [...document.querySelectorAll('main .lc-agentline__body')].at(-1)
    if (!body) return JSON.stringify({ found: false })
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf('The bridge is old')
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 'The bridge is old'.length)
      const rects = range.getClientRects()
      const first = rects[0]
      const last = rects[rects.length - 1]
      return JSON.stringify({ found: true, x1: first.left + 1, y1: first.top + first.height / 2, x2: last.right - 1, y2: last.top + last.height / 2 })
    }
    return JSON.stringify({ found: false, text: body.innerText.slice(0, 200) })
  })()`)))
  check('the reply holds the sentence to select', at.found === true, JSON.stringify(at))
  if (!at.found) throw new Error('nothing to select')
  await mouse('mouseMoved', at.x1, at.y1, { button: 'none', clickCount: 0 })
  await mouse('mousePressed', at.x1, at.y1)
  await mouse('mouseMoved', (at.x1 + at.x2) / 2, at.y2, { buttons: 1 })
  await mouse('mouseMoved', at.x2, at.y2, { buttons: 1 })
  await mouse('mouseReleased', at.x2, at.y2)
  const button = JSON.parse(String(await drive.capture('selected: the button above it', () => drive.evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 400))
    const b = document.querySelector('.lc-selectionask')
    const box = b?.getBoundingClientRect()
    return JSON.stringify({ selected: window.getSelection()?.toString() ?? '', shown: !!b, label: b?.innerText.trim() ?? null, x: box ? box.left + box.width / 2 : null, y: box ? box.top + box.height / 2 : null })
  })()`))))
  check('a drag across words of the reply selects them', /The bridge is old/.test(button.selected), JSON.stringify(button))
  check('and "Ask about this" appears above them', button.shown === true && button.label === 'Ask about this', JSON.stringify(button))
  if (button.x !== null) {
    await mouse('mouseMoved', button.x, button.y, { button: 'none', clickCount: 0 })
    await mouse('mousePressed', button.x, button.y)
    await mouse('mouseReleased', button.x, button.y)
  }
  const box = String(await drive.capture('pressed: the quote in the box', () => drive.evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 500))
    return document.querySelector('form.command-dock textarea')?.value ?? ''
  })()`)))
  check('pressed, the words are quoted into the message box', /^> .*The bridge is old/.test(box), JSON.stringify(box))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on a free model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
