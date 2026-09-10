// A real reply, in a real thread, at three window sizes.
//
//   LOCUST_SPEND=1 node _tools/probe-reply-fills-the-window.mjs
//
// Colin, 2026-09-10: "it seems way too small with too much dead space
// especially on your larger testing app... claude code ... auto fits the text
// to the size of the window."
//
// The earlier attempt measured a paragraph injected into an EMPTY home
// screen, where `.lc-thread__column` does not exist -- so it fell back to the
// body and reported the whole window as room the text had failed to use. Two
// wrong numbers in a row from the same mistake. This one runs a mission, so
// the column being measured is the one a person actually reads in.
//
// SPENDS one Claude Code turn on sonnet at low effort, and reads the thread
// at each size afterwards without asking again.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const SIZES = [
  { width: 1280, height: 860 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1040 }
]

const workspace = await scratchRepository('locust-fills-ws-')
const drive = await startDrive({
  name: 'reply-fills-the-window',
  port: 9479,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// No backticks anywhere in here: the whole block is a template literal, and a
// backtick inside one ends it. That cost a run already today.
const measure = `(() => {
  const p = [...document.querySelectorAll('.lc-agentline__body p')].sort(
    (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width
  )[0]
  if (p === undefined) return JSON.stringify({ error: 'no reply paragraph on screen' })
  const column = document.querySelector('.lc-thread__column')
  const style = getComputedStyle(p)
  const ruler = document.createElement('span')
  ruler.style.font = style.font
  ruler.style.position = 'absolute'
  ruler.style.whiteSpace = 'pre'
  ruler.textContent = 'abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz'
  document.body.appendChild(ruler)
  const perChar = ruler.getBoundingClientRect().width / ruler.textContent.length
  ruler.remove()
  const used = p.getBoundingClientRect().width
  const columnWidth = column === null ? 0 : column.getBoundingClientRect().width
  return JSON.stringify({
    window: window.innerWidth,
    readingColumnPx: Math.round(columnWidth),
    paragraphUsedPx: Math.round(used),
    unusedInsideColumnPx: Math.round(columnWidth - used),
    charsPerLine: Math.round(used / perChar),
    fontSize: style.fontSize,
    maxWidth: style.maxWidth
  }, null, 1)
})()`

try {
  await drive.capture('ask for a few paragraphs', async () => {
    await drive.ready()
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Write three short paragraphs about caching. No headings, no lists, no code.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      field.form.requestSubmit()
      for (let i = 0; i < 300; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      return true
    })()`)
    return drive.evaluate(measure)
  })

  for (const size of SIZES) {
    await drive.capture(`the same reply at ${String(size.width)} wide`, async () => {
      await drive.resize(size.width, size.height)
      await drive.evaluate(`new Promise(r => setTimeout(r, 600))`)
      return drive.evaluate(measure)
    })
  }
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet at low effort writes three paragraphs; the same reply is then measured and photographed at 1280, 1600 and 1920 wide.'
  })
}
