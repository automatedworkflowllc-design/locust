// A Claude Code teammate searches the web: asked first outside Auto, unasked in Auto (0.711).
//
//   LOCUST_SPEND=1 node _tools/drive-a-claude-searches-the-web.mjs [--packaged <exe>] [--mode ask|auto]
//
// Until 0.711 a Claude teammate had no web tools in any mode (Colin's teammate, asked about news, could only offer
// SEC filings). Now WebSearch and WebFetch are named in every mode; outside Auto, Claude Code asks before each and the
// asking goes through Locust's bridge to an approval card. This asks a Haiku teammate for a fact only a search
// finds. In Ask: a card appears saying "Search the web" with the words it would send, Allow once lets it through,
// and the record shows the WebSearch. In Auto: no card, and the search runs.
//
// Spends: one short Haiku turn on Colin's Claude account, plus the search Claude Code makes.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const mode = arg('--mode') ?? 'ask'
if (mode !== 'ask' && mode !== 'auto') throw new Error('--mode is ask or auto')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-claude-searches-the-web-${mode}`, port: 9875, workspace: await scratchRepository('locust-drive-web-ws-'), spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: mode === 'auto' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const running = () => drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`).then((value) => String(value) === 'true')
const CARD = `JSON.stringify((() => {
  const actions = [...document.querySelectorAll('.lc-approval__actions')].at(-1)
  if (!actions) return { shown: false }
  const card = actions.closest('.lc-approval') ?? actions.parentElement
  return { shown: true, title: document.querySelector('.lc-approval__title')?.innerText.replace(/\\s+/g, ' ').trim() ?? '', text: (card?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 600) }
})())`

try {
  await drive.capture('launch', () => drive.ready())
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  const sent = await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify('Use your web search tool to find the latest stable version of Electron (the desktop app framework) and reply with just that version number. Do not guess from memory.')})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'not sent'
  })()`)
  check('sent', String(sent) === 'sent', String(sent))

  // Every card is read, then answered Allow once, until the run ends.
  const cards = []
  for (let i = 0; i < 300; i += 1) {
    await sleep(1000)
    const seen = JSON.parse(String(await drive.evaluate(CARD)))
    if (seen.shown) {
      if (cards.length === 0) await drive.capture('the first card', () => JSON.stringify(seen))
      cards.push(seen)
      await drive.evaluate(`[...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Approve once$|^Allow once$/.test(b.innerText.trim()))?.click()`)
      await sleep(800)
      continue
    }
    if (i > 5 && !(await running())) break
  }
  const reply = String(await drive.capture('the reply', () => drive.evaluate(`(() => [...document.querySelectorAll('.lc-thread .lc-agentline__body')].at(-1)?.innerText ?? '')()`)))
  say(`  reply: ${reply.replace(/\s+/g, ' ').slice(0, 200)}`)
  say(`  cards: ${JSON.stringify(cards.map((card) => card.title))}`)

  const tools = []
  for (const file of (await readdir(join(drive.profile, 'mission-ledger'))).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(drive.profile, 'mission-ledger', file), 'utf8')).split('\n')) {
      try {
        const event = JSON.parse(line).event
        if (event?.type === 'tool.started') tools.push(event.payload?.name ?? '')
      } catch { /* a partial line */ }
    }
  }
  say(`  tools: ${JSON.stringify(tools)}`)
  const searched = tools.some((name) => /^web_?search$/i.test(name) || /websearch/i.test(name))
  if (mode === 'ask') {
    check('outside Auto, the search asked first, on a card that says so', cards.some((card) => /Search the web/.test(card.text)), JSON.stringify(cards[0] ?? null))
    check('and the card shows the words it would send', cards.some((card) => /electron/i.test(card.text)), cards[0]?.text)
  } else {
    check('in Auto, nothing asked', cards.length === 0, JSON.stringify(cards))
  }
  check('the run searched the web', searched, JSON.stringify(tools))
  check('and answered with a version number', /\b\d{2,3}\.\d+(?:\.\d+)?\b/.test(reply), reply.slice(0, 160))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, ${mode}, asked for a fact only a search finds.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
