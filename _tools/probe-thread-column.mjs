// Where a conversation's text sits against the box under it (0.529).
//
//   node _tools/probe-thread-column.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-01, beside a Claude screenshot: "they seem to align their
// chats with the chat bar". Measures, in the everyday profile's login-redirect
// conversation, the box's left and right edges against a reply's text, a
// person's bubble, the teammate's face and the step lines, at three window
// sizes. Sends nothing.

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const everyday = await seedEverydayLedger('probe-thread-column')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `probe-thread-column-${tag}`,
  port: 9851,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  outPath: join(recordRoot('probe-thread-column-2026-10-01'), tag),
  seed: everyday.seed
})
const MEASURE = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] }
  // The widest a line of text reaches inside an element, from its text's own boxes.
  const text = (el) => {
    if (!el) return null
    const range = document.createRange(); range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0)
    if (rects.length === 0) return null
    return [Math.round(Math.min(...rects.map((r) => r.left))), Math.round(Math.max(...rects.map((r) => r.right)))]
  }
  const form = document.querySelector('form.command-dock')
  const field = document.querySelector('form.command-dock textarea')
  const replies = [...document.querySelectorAll('.lc-thread .lc-agentline__body')]
  return JSON.stringify({
    window: innerWidth,
    scrolls: (() => { const t = document.querySelector('.lc-thread'); return t ? t.scrollHeight > t.clientHeight : null })(),
    composer: box(form),
    field: box(field),
    thread: box(document.querySelector('.lc-thread')),
    replyBoxes: replies.slice(0, 3).map(box),
    replyText: replies.slice(0, 3).map(text),
    face: box(document.querySelector('.lc-thread .lc-agentline > :first-child')),
    bubble: box(document.querySelector('.lc-thread .lc-bubble, .lc-thread .lc-message--user')),
    steps: box(document.querySelector('.lc-thread .lc-turnfoot'))
  })
})()`
try {
  await drive.ready()
  const sizes = process.env.PROBE_SIZES === undefined ? [[1209, 770], [1440, 900], [1920, 1040]] : process.env.PROBE_SIZES.split(',').map((size) => size.split('x').map(Number))
  for (const [w, h] of sizes) {
    await drive.resize(w, h)
    await sleep(1500)
    await drive.evaluate(`(async () => {
      ;[...document.querySelectorAll('.lc-convrow button.lc-conv')].find((r) => new RegExp(${JSON.stringify(process.env.PROBE_CONV ?? 'login redirect')}, 'i').test(r.innerText))?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return 1
    })()`)
    const got = String(await drive.capture(`${String(w)}x${String(h)}`, () => drive.evaluate(MEASURE)))
    say(`  ${String(w)}: ${got}`)
  }
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The thread column against the box, measured.`, extra: '' })
}
