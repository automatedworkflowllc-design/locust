// Does the context ring ever actually appear?
//
//   node _tools/drive-context-ring.mjs
//
// Colin, 2026-09-07: "still no context wheel". The ring is drawn only where
// the runtime states its own window -- his own rule from 2026-09-06, so the
// app never divides by a denominator it made up. Reading the adapters, only
// claude-events.ts ever sets `contextWindow`; Codex, Cursor, OpenCode,
// Copilot and Antigravity never do.
//
// If that is the whole story, the ring should be absent before any run,
// absent on a Codex run, and PRESENT after a Claude run. If it is absent
// after a Claude run too, the rule is not the reason and something is broken.
//
// Spends one small Claude Code run.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-ring-ws-')
const drive = await startDrive({
  name: 'context-ring',
  port: 9336,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z'
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const RING = `(async () => {
  const ring = document.querySelector('.lc-contextring')
  if (!ring) return 'no ring'
  const holder = ring.closest('[title]') ?? ring
  return 'RING PRESENT :: ' + (holder.getAttribute('title') ?? ring.getAttribute('aria-label') ?? 'no label')
})()`

const RUN = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Reply with exactly the word RING and nothing else. Do not read any files.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 180; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    if (/completed|failed|cancelled/i.test(text)) return 'settled after ' + (i + 1) + 's'
  }
  return 'never settled'
})()`

try {
  await drive.capture('before any run, on the starting route', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(RING)
  })

  await drive.capture('pick Claude Code / Sonnet, the one runtime that reports a window', () =>
    drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
  )

  await drive.capture('run one short mission', () => drive.evaluate(RUN))

  await drive.capture('and now?', () => drive.evaluate(RING))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Whether the context ring appears once a runtime has actually reported its window.'
  })
}
