// Does text a person has already read ever change shape while a reply streams?
//
//   LOCUST_SPEND=1 node _tools/probe-stream-settles.mjs
//   LOCUST_SPEND=1 LOCUST_RUNTIME=codex node _tools/probe-stream-settles.mjs
//   LOCUST_SPEND=1 LOCUST_RUNTIME=cursor node _tools/probe-stream-settles.mjs
//
// Colin, 2026-09-10: "compared to claude code and codex, the text seems to
// come out rather aggressively or glitchy." Half of that is cadence -- every
// delta was its own render -- and half is reflow: a delta that closed a `*`
// or a fence reclassified text already on screen.
//
// This measures the second half directly. While a reply streams, the DOM is
// sampled every 80ms. For each sample, every paragraph EXCEPT the last one
// (the one still arriving) is recorded as rendered HTML. A paragraph that was
// rendered one way and later rendered another way -- same position, different
// markup -- is a reflow, and is counted. The number this exists to produce
// is zero.
//
// It also counts samples in which the visible text changed, which is a rough
// floor on how many distinct paints happened. It cannot see React commits
// from outside, so it is a floor and is reported as one.
//
// SPENDS one turn on the chosen runtime: Claude Code on sonnet at low effort
// by default; Codex on gpt-5.6-luna at low effort, never Astra; Cursor on
// composer-2.5, which is quota Colin said is free to use. The frame batcher
// and the settled split are runtime-blind, and this is what proves it: the
// same sample on each. The prompt asks for emphasis and a code fence on
// purpose: those are the two tokens that caused the reflow, so a reply
// without them would measure nothing.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const ROUTES = {
  claude: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' },
  codex: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'accept-edits', effort: 'low' },
  cursor: { runtime: 'cursor', model: 'composer-2.5', mode: 'accept-edits' }
}
const which = process.env.LOCUST_RUNTIME ?? 'claude'
const route = ROUTES[which]
if (route === undefined) {
  say(`refusing to run: LOCUST_RUNTIME must be one of ${Object.keys(ROUTES).join(', ')}, not "${which}".`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-stream-ws-')
const drive = await startDrive({
  name: `stream-settles-${which}`,
  port: 9465,
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
        route
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('stream a reply that uses emphasis and a fence, sampling as it arrives', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 700))
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Write four short paragraphs about caching. Use **bold** for one key term in each paragraph and *italics* once. Between the second and third paragraph include a fenced code block with a three-line JavaScript example. No headings, no lists.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      field.form.requestSubmit()

      // Sample the settled paragraphs -- every block but the last -- until the
      // run ends. A block that renders differently at the same index later is
      // a reflow.
      const seen = new Map()   // index -> first html rendered at that index
      let reflows = []
      let appends = 0
      let samples = 0
      let textChanges = 0
      let lastText = ''
      let sawArriving = false
      for (let i = 0; i < 900; i += 1) {
        await new Promise(r => setTimeout(r, 80))
        const body = [...document.querySelectorAll('.lc-agentline__body')].at(-1)
        if (body) {
          const blocks = [...body.children].filter(n => n.matches('p, pre, ul, ol, h3, h4, h5'))
          if (body.querySelector('.lc-para--arriving')) sawArriving = true
          const settledBlocks = blocks.slice(0, -1)
          settledBlocks.forEach((node, index) => {
            // The INTENDED transition -- a raw arriving paragraph becoming a
            // formatted one when it settles -- is not a reflow, and the first
            // version of this probe counted it as one. A block is only held
            // to account from the first sample in which it was already
            // settled; changing after THAT is the defect.
            if (node.classList.contains('lc-para--arriving')) return
            const html = node.outerHTML.replace(/<span class="lc-caret"><\\/span>/g, '')
            const text = node.innerText
            const before = seen.get(index)
            if (before === undefined) { seen.set(index, { html, text }); return }
            if (before.html === html) return
            // Three cases, only two of which are the defect. A settled block
            // that GREW -- the parser keeps blank-line paragraphs in one
            // element, drawn apart by pre-line, so a paragraph settling is
            // appended into the previous element -- leaves everything a
            // person read exactly where it was. The first version of this
            // probe counted 54 of those as reflows.
            if (before.text === text) reflows.push({ kind: 'FORMAT', index, before: before.html, after: html })
            else if (!text.startsWith(before.text)) reflows.push({ kind: 'CONTENT', index, before: before.text.slice(-120), after: text.slice(0, before.text.length).slice(-120) })
            else appends += 1
            seen.set(index, { html, text })
          })
          const text = body.innerText
          if (text !== lastText) { textChanges += 1; lastText = text }
          samples += 1
        }
        if (i > 12 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      await new Promise(r => setTimeout(r, 800))
      window.__reflows = JSON.stringify(reflows.slice(0, 2))
      const finalBlocks = [...([...document.querySelectorAll('.lc-agentline__body')].at(-1)?.children ?? [])].map(n => n.tagName.toLowerCase())
      return JSON.stringify({
        samples,
        paintsAtLeast: textChanges,
        settledBlocksReflowed: reflows.length,
        settledBlocksAppendedTo: appends,
        reflows: reflows.slice(0, 2),
        arrivingParagraphSeen: sawArriving,
        finalBlocks
      }, null, 1)
    })()`)
  })

  // The pairs, to the terminal, where nothing truncates them.
  const pairs = String(await drive.evaluate(`window.__reflows ?? 'none recorded'`))
  say(`  reflow pairs: ${pairs.slice(0, 1800)}`)
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: whatever \`pnpm build\` last wrote to out/. One teammate on ${route.runtime} / ${route.model}${route.effort ? ` at ${route.effort} effort` : ''}, asked for prose with bold, italics and a fence. The DOM was sampled every 80ms while it streamed; the number that matters is settledBlocksReflowed.`
  })
}
