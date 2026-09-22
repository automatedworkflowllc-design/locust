// Can you tell the app narrating from the teammate talking?
//
//   LOCUST_SPEND=1 node _tools/probe-live-line-says-which.mjs
//
// Colin, 2026-09-11: "we should introduce this ... for all, writing thinking
// and tool calls, mcp, etc. to distinguish it from text from the teammate."
//
// The live line used to be whatever the runtime said -- "Exploring the
// repository" -- in the same place, shape and colour as a sentence of the
// reply, with a face and three dots between them. A person reading quickly
// had no reliable way to tell a narrated step from the answer.
//
// What this measures: while a run is live, every live line must carry a
// register word derived from the STEP, not from its wording, and that word
// must be one of the five the app knows. A run that reads a file has to
// produce a tool register at some point -- otherwise the line is still just
// prose about work.
//
// SPENDS one Claude Code turn on sonnet at low effort.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-liveline-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'live-line-says-which',
  port: 9496,
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

// No backticks inside these template literals.
const send = `(async () => {
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Jimothy/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 600))
  const box = document.querySelector('.lc-composer__box textarea')
  if (box === null) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, 'Read README.md and reply with its first line only.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-composer__form').requestSubmit()
  return 'sent'
})()`

/**
 * Sample the live line for as long as the run is live.
 *
 * Every distinct (register, rendered line) pair is kept, so the answer says
 * what a person would actually have read, not just which registers fired.
 */
const watch = `(async () => {
  const seen = new Map()
  let live = 0
  for (let i = 0; i < 600; i += 1) {
    const step = document.querySelector('.lc-livestep')
    if (step !== null) {
      live += 1
      const register = step.getAttribute('data-register') ?? '(none)'
      const who = step.querySelector('.lc-face')?.getAttribute('aria-label')?.trim() ?? ''
      const word = step.querySelector('.lc-livestep__register')?.innerText.trim() ?? ''
      seen.set(register + '|' + who + '|' + word, (seen.get(register + '|' + who + '|' + word) ?? 0) + 1)
    } else if (live > 0) {
      break
    }
    await new Promise(r => setTimeout(r, 200))
  }
  await new Promise(r => setTimeout(r, 800))
  const answer = [...document.querySelectorAll('.lc-agentline__body')].at(-1)?.innerText.trim() ?? 'no answer'
  return JSON.stringify({
    liveSamples: live,
    lines: [...seen.keys()],
    registers: [...new Set([...seen.keys()].map(k => k.split('|')[0]))].sort(),
    // The whole point: the app narrating never looks like the teammate talking.
    everyLineNamedItsRegister: [...seen.keys()].every(k => k.split('|')[2].length > 0),
    everyLineNamedWho: [...seen.keys()].every(k => k.split('|')[1] === 'Jimothy'),
    sawATool: [...seen.keys()].some(k => k.startsWith('tool|')),
    answer: answer.slice(0, 120)
  }, null, 1)
})()`

try {
  await drive.capture('send a mission that has to read a file', async () => {
    await drive.ready()
    return drive.evaluate(send)
  })

  await drive.capture('every live line says whose and which', () => drive.evaluate(watch))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet, low effort, asked to read a file. Every live line must carry the teammate’s name and a register word derived from the step, and a run that reads a file must produce a tool register.'
  })
}
