// Does a finished turn say what it RAN, not only what it changed?
//
//   LOCUST_SPEND=1 node _tools/probe-composer-row.mjs
//
// Astra, 2026-09-11: a turn's line says what it CHANGED -- `3 files` -- and
// never what it ran, so a run that edited three files and a run that edited
// three files and proved them read identically. The ledger has had the
// commands and their exit codes the whole time.
//
// The rule, and the reason this is part 1a rather than the whole proposal:
// NO INFERENCE ABOUT WHAT A COMMAND MEANS. Nothing decides that `pnpm test`
// is a test and `ls` is not. The line says what ran and what came back; a
// reader decides whether that is evidence.
//
// What this measures, on a real run asked to do exactly that: the closed
// trace line names the commands and their outcome, and an ordinary tool call
// is still counted separately rather than swallowed by them.
//
// SPENDS one Claude Code turn on sonnet at low effort.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-composerrow-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'composer-row',
  port: 9501,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_jim',
        name: 'Jimothy',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: now,
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

const ASK = 'Reply with the single word: ok. Change no files and run no commands.'

// No backticks inside these template literals.
const send = `(async () => {
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Jimothy/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 600))
  const box = document.querySelector('.lc-composer__box textarea')
  if (box === null) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(ASK)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-composer__form').requestSubmit()
  return 'sent'
})()`

const watch = `(async () => {
  const busy = () => [...document.querySelectorAll('.lc-row__metastate')]
    .some(n => /working|thinking|using|starting|writing/i.test(n.innerText))
  let quiet = 0
  for (let i = 0; i < 600; i += 1) {
    await new Promise(r => setTimeout(r, 400))
    quiet = busy() ? 0 : quiet + 1
    if (quiet >= 10) break
  }
  await new Promise(r => setTimeout(r, 1200))
  const box = (sel) => {
    const n = document.querySelector(sel)
    if (n === null) return null
    const r = n.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right) }
  }
  const plus = document.querySelector('[aria-label=\"Attach files\"]')
  const ring = box('.lc-composer__context')
  // The ROUTE chip specifically. `.lc-control__anchor` matches the mode chip
  // too, and it is first on the row -- so comparing against it reported the
  // ring as "not left of the route" while the screenshot showed it exactly
  // there.
  const route = box('button[aria-haspopup=\"listbox\"]')
  return JSON.stringify({
    plusClasses: plus === null ? 'no plus' : plus.className,
    plusIsBare: plus !== null && !plus.className.includes('boxed'),
    ringDrawn: ring !== null,
    ringLeftOfRoute: ring !== null && route !== null ? ring.right <= route.left + 2 : null,
    ringStillInHeader: document.querySelector('.lc-workroom__context') !== null,
    headerLine: document.querySelector('.lc-workroom__meta, .lc-screen__meta')?.innerText.split(String.fromCharCode(10)).join(' ').slice(0, 120) ?? 'none'
  }, null, 1)
})()`

const sendThenWatch = `(async () => {
  const sent = await ${send}
  if (sent !== 'sent') return 'NOT THE TEST: ' + String(sent)
  return await ${watch}
})()`

try {
  await drive.capture('the composer row after a turn', async () => {
    await drive.ready()
    return drive.evaluate(sendThenWatch)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet asked to run three shell commands and change nothing. The closed trace line must name what it ran and how the commands came out.'
  })
}
