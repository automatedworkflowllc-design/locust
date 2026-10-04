// The approval card says what a command reaches, on a real run (0.578).
//
//   node _tools/drive-a-command-that-reaches-asks.mjs [--packaged <exe>] [--tag <name>]
//
// Free model, in Approve each. Wren is asked to run
// `taskkill /IM locust-no-such-program.exe` -- a name no program has, so it
// could stop nothing even if it ran -- and every card is DENIED. Reads the
// card's Reaches line from the real request the runtime sent (the render test
// builds its own), then checks the run ended with the command declined and
// no reach badge on the declined row.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('a-command-that-reaches-2026-10-04'), `asks-${tag}`)
await mkdir(OUT, { recursive: true })
const PROGRAM = 'locust-no-such-program.exe'
const workspace = await scratchRepository('locust-reach-asks-ws-')
const drive = await startDrive({
  name: `a-command-that-reaches-asks-${tag}`, port: 9794, workspace, outPath: OUT, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'approve-each' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const running = async () => String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'true'
const CARD = `JSON.stringify((() => {
  const actions = [...document.querySelectorAll('.lc-approval__actions')].at(-1)
  if (!actions) return { shown: false }
  const card = actions.closest('.lc-card')
  const rows = {}
  for (const dt of card?.querySelectorAll('.lc-receipt dt') ?? []) rows[dt.textContent.trim()] = dt.nextElementSibling?.textContent.replace(/\\s+/g, ' ').trim() ?? ''
  const reach = card?.querySelector('.lc-approval__reach')
  const plain = [...(card?.querySelectorAll('.lc-receipt dd') ?? [])].find((dd) => dd !== reach && !dd.classList.contains('lc-mono'))
  return { shown: true, rows, colour: reach ? getComputedStyle(reach).color : null, plain: plain ? getComputedStyle(plain).color : null }
})())`
const DENY = `(() => {
  const button = [...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Deny/.test(b.innerText.trim()))
  button?.click()
  return new Promise((r) => setTimeout(() => {
    const confirm = [...document.querySelectorAll('.lc-approval__actions button, .lc-card button')].find((b) => /^Deny$/.test(b.innerText.trim()) && b !== button)
    confirm?.click()
    r(button ? 'denied' : 'no deny button')
  }, 400))
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(600)
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(`Run exactly this one shell command and nothing else: taskkill /IM ${PROGRAM}  Then reply with the word DONE.`)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'not sent'
  })()`))
  check('the task is sent', sent === 'sent', sent)
  let first
  const seen = []
  for (let i = 0; i < 360; i += 1) {
    await sleep(1000)
    const card = JSON.parse(String(await drive.evaluate(CARD)))
    if (card.shown) {
      seen.push(card.rows.Exact ?? '')
      if (first === undefined && /taskkill/i.test(card.rows.Exact ?? '')) {
        first = card
        await drive.capture('the card for taskkill', async () => JSON.stringify(card))
      }
      await drive.evaluate(DENY)
      continue
    }
    if (i > 10 && !(await running())) break
  }
  say(`  cards seen: ${JSON.stringify(seen)}`)
  check('a card asked about the taskkill command', first !== undefined, JSON.stringify(seen).slice(0, 200))
  check('the card says what it reaches', first?.rows.Reaches === `Stops every ${PROGRAM} on this computer, not only the ones this run started.`, first?.rows.Reaches ?? 'no Reaches row')
  check('drawn apart from the rows around it (amber)', first?.colour !== null && first?.colour !== undefined && first.colour !== first.plain, `${String(first?.colour)} vs ${String(first?.plain)}`)
  check('every card was denied and the run ended', !(await running()))
  await drive.evaluate(`(() => { for (const b of document.querySelectorAll('.lc-thread .lc-steps__line[aria-expanded="false"]')) b.click(); return true })()`)
  await sleep(600)
  const after = await drive.capture('after the denial', () => drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-thread .lc-filerow.is-shell')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()))`))
  check('the declined row draws no reach badge (it never ran)', !String(after).includes('stops every'), String(after).slice(0, 200))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on a free model in Approve each, asked to run taskkill /IM ${PROGRAM}; every card denied.`, extra: `Checks failed: ${String(failures)}` })
  say(failures === 0 ? 'PASSED' : `FAILED (${String(failures)})`)
  process.exitCode = failures === 0 ? 0 : 1
}
