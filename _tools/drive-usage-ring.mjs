// An account shows how full it is -- on hover (0.389; 0.388 drew a ring).
//
//   LOCUST_SPEND=1 node _tools/drive-usage-ring.mjs [--packaged <exe>] [--tag <name>]
//   node _tools/drive-usage-ring.mjs --no-turn [--packaged <exe>] [--tag <name>]
//
// --no-turn spends nothing: since 0.390 the model catalog asks Codex's own
// server for the account's usage (`account/rateLimits/read`) beside its
// models, so the card has a reading before any turn has run.
//
// SPENDS one tiny turn of the person's own Codex plan (the cheapest model the
// catalog lists, one word asked for). The round trip is the point: Codex's
// app-server pushes its rate-limit snapshot during a turn; Locust keeps it as
// a `codex.usage_window` reading (0.388); the host hands the latest to the
// window; and on Home, POINTING at Codex's mark -- the mouse moved there
// through the window's own input, as a hand would -- opens its card with a
// bar for each window. Colin, 2026-09-27, of 0.388: "the hover logo wasnt
// working". The row itself must be plain marks, no rings.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('usage-ring-2026-09-27'), `usage-hover-${tag}`)
await mkdir(OUT, { recursive: true })
const MODEL = process.env.LOCUST_CODEX_MODEL ?? 'gpt-6-luna'
const NO_TURN = process.argv.includes('--no-turn')

const workspace = await scratchRepository('locust-usage-hover-ws-')
const drive = await startDrive({
  name: `usage-hover-${tag}`,
  port: 9689,
  workspace,
  launchElsewhere: true,
  outPath: OUT,
  spends: !NO_TURN,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-27T05:00:00.000Z', route: { runtime: 'codex', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** Move the pointer to the middle of the mark for `runtime`, as the mouse would, and read what shows. */
const hover = async (runtime) => {
  const box = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
    const mark = document.querySelector('.lc-agenthead__marks .lc-agentmark .lc-runtimemark[data-runtime="${runtime}"]')?.closest('.lc-agentmark')
    if (!mark) return null
    const rect = mark.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })())`)))
  if (box === null) return null
  await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y) })
  await sleep(400)
  return JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
    const mark = document.querySelector('.lc-agenthead__marks .lc-agentmark .lc-runtimemark[data-runtime="${runtime}"]')?.closest('.lc-agentmark')
    const card = mark?.querySelector('.lc-agentcard')
    const style = card ? getComputedStyle(card) : null
    const rect = card?.getBoundingClientRect()
    return {
      open: style !== null && style.display !== 'none',
      name: card?.querySelector('.lc-agentcard__name')?.textContent ?? null,
      state: card?.querySelector('.lc-agentcard__state')?.textContent ?? null,
      windows: [...(card?.querySelectorAll('.lc-agentcard__window') ?? [])].map((w) => [w.querySelector('.lc-agentcard__label')?.textContent, w.querySelector('.lc-agentcard__percent')?.textContent, w.querySelector('.lc-agentcard__fill')?.style.width]),
      // Nothing in the card runs off its edge (Colin, 2026-09-27: "the text
      // clearly running off" on Cursor's).
      runsOff: card === null || card === undefined ? null : [card, ...card.querySelectorAll('*')].some((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).textOverflow !== 'ellipsis'),
      above: rect === undefined ? null : rect.bottom <= mark.getBoundingClientRect().top,
      inView: rect === undefined ? null : rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth
    }
  })())`)))
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  if (!NO_TURN) {
  say(String(await drive.evaluate(openTeammateScript('Juno'))))
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly one word: ready. Do not use any tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const send = document.querySelector('button[aria-label="Send"]')
      if (send && !send.disabled) { send.click(); return 'sent' }
    }
    return 'could not send'
  })()`))
  say(`Juno: ${sent}`)
  await sleep(3000)
  for (let i = 0; i < 240; i += 1) {
    const live = String(await drive.evaluate(`String(!!document.querySelector('button[aria-label^="Stop the running"]'))`)) === 'true'
    if (!live) break
    await sleep(500)
  }
  } else {
    // Only the catalog: give it the time its server read takes.
    await sleep(9000)
  }
  // Home: the row, then the pointer on Codex's mark.
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  await sleep(1500)
  // Every item in the row is a mark and nothing else -- the rings of 0.388
  // wrapped some of them.
  const row = JSON.parse(String(await drive.evaluate(`JSON.stringify({ marks: document.querySelectorAll('.lc-agenthead__marks > .lc-agentmark').length, items: document.querySelector('.lc-agenthead__marks')?.children.length ?? 0 })`)))
  check('the row is plain marks again: every item a mark', row.marks > 0 && row.items === row.marks, JSON.stringify(row))
  const codex = await hover('codex')
  await drive.capture('Home: pointing at Codex’s mark', () => JSON.stringify(codex))
  check('pointing at Codex’s mark opens its card: name, state, a bar per window its turn reported', codex?.open === true && codex.name === 'Codex CLI' && /^Ready/.test(codex.state ?? '') && codex.windows.length >= 1 && codex.windows.every(([label, percent, width]) => /window$/.test(label ?? '') && /^\d{1,3}%$/.test(percent ?? '') && width === percent), JSON.stringify(codex))
  check('the card opens above the mark, inside the window', codex?.above === true && codex.inView === true, JSON.stringify({ above: codex?.above, inView: codex?.inView }))
  const other = await hover('cursor')
  check('an agent whose runs reported nothing opens its name and state alone', other === null || (other.open === true && other.windows.length === 0), JSON.stringify(other))
  check('no text in either card runs off its edge', codex?.runsOff === false && (other === null || other.runsOff === false), JSON.stringify({ codex: codex?.runsOff, cursor: other?.runsOff }))
  await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await sleep(300)
  const closed = String(await drive.evaluate(`String([...document.querySelectorAll('.lc-agentcard')].every((card) => getComputedStyle(card).display === 'none'))`))
  check('and it closes when the pointer leaves', closed === 'true', closed)
  say(failures === 0 ? '\nUSAGE HOVER PASSED' : `\nUSAGE HOVER: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Juno on Codex's ${MODEL}, one word asked -- then Home, pointing at Codex's mark to open the card with the reading that turn reported.` })
}
