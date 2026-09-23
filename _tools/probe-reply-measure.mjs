// How many characters is a reply line, really?
//
//   LOCUST_SPEND=1 node _tools/probe-reply-measure.mjs
//
// Colin, 2026-09-10, on the chat: "slightly clunky or out of place, can't put
// my finger on it." Half of that is not the typeface -- it is the measure.
//
// Counted off the RENDERED line boxes, character by character, and the first
// line is read back verbatim so the number can be checked against words
// rather than trusted. Text has no mean character width: probing with a
// string of zeros understates prose by about a fifth, because a digit is
// wider than an average letter in every face involved.
//
// SPENDS one short Claude Code turn on sonnet at low effort, asked for three
// paragraphs of ordinary prose -- because the thing being measured is prose,
// and a fixture typed here would be prose I chose the width of.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-measure-ws-')
const drive = await startDrive({
  name: 'reply-measure',
  port: 9464,
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

// The measurement, run against whatever prose is on screen.
const measure = `(() => {
  function perLine(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    const counts = new Map()
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? ''
      for (let i = 0; i < text.length; i += 1) {
        range.setStart(node, i); range.setEnd(node, i + 1)
        const top = Math.round(range.getBoundingClientRect().top)
        counts.set(top, (counts.get(top) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)
  }
  const paragraphs = [...document.querySelectorAll('.lc-agentline p')].filter(p => (p.textContent ?? '').length > 200)
  if (paragraphs.length === 0) return JSON.stringify({ error: 'no reply paragraph on screen' })
  const first = paragraphs[0]
  const style = getComputedStyle(first)
  const lines = perLine(first)
  // The first rendered line, read back, so the count can be checked by eye.
  const node = first.firstChild
  const range = document.createRange()
  let top = null, line = ''
  if (node && node.nodeType === 3) {
    for (let i = 0; i < node.textContent.length; i += 1) {
      range.setStart(node, i); range.setEnd(node, i + 1)
      const t = Math.round(range.getBoundingClientRect().top)
      if (top === null) top = t
      if (t !== top) break
      line += node.textContent[i]
    }
  }
  return JSON.stringify({
    widthPx: Math.round(first.getBoundingClientRect().width),
    font: style.fontFamily.split(',')[0],
    size: style.fontSize,
    lineHeight: style.lineHeight,
    charsPerLine: lines.slice(0, 6),
    longest: Math.max(...lines),
    firstLine: line
  }, null, 1)
})()`

try {
  await drive.capture('ask for a reply long enough to have a measure', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 700))
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Write three paragraphs of ordinary prose about why long line lengths are tiring to read. No lists, no code, no headings. Plain sentences.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      field.form.requestSubmit()
      for (let i = 0; i < 360; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      await new Promise(r => setTimeout(r, 1500))
      return 'paragraphs on screen: ' + document.querySelectorAll('.lc-agentline p').length
    })()`)
  })

  // The premise, OUTSIDE capture(): with no long paragraph there is nothing
  // to measure, and a reading of zero would look like a very short line.
  const paragraphs = Number(await drive.evaluate(`[...document.querySelectorAll('.lc-agentline p')].filter(p => (p.textContent ?? '').length > 200).length`))
  if (paragraphs === 0) throw new Error('NOTHING TO MEASURE: no reply paragraph over 200 characters is on screen')
  say(`  ${String(paragraphs)} paragraph(s) long enough to measure`)

  await drive.capture('characters per rendered line', () => drive.evaluate(measure))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Nothing run and nothing sent -- the reply on screen is read and its line boxes counted.' })
}
