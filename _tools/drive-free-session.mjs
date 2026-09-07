// A whole session the way a person has one, on a free model.
//
//   node _tools/drive-free-session.mjs
//
// Codex limits are spent and Colin is testing on Cursor, so this stays on
// OpenCode's free no-sign-in models: real runs, real turns, no quota to
// misread as a defect later.
//
// Four things a first tester will do within ten minutes, and which nothing
// has driven end to end together:
//   1. ask something, get an answer
//   2. follow up in the same conversation, relying on it remembering
//   3. change your mind mid-run and stop it
//   4. switch to Ask and confirm it will not write
//
// Each step reports what the screen actually said, so a failure names itself.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-free-session-ws-')
const drive = await startDrive({
  name: 'free-session',
  port: 9339,
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

const send = (text, waitSeconds) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < ${waitSeconds}; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    if (/completed|failed|cancelled/i.test(text)) {
      const thread = document.querySelector('.lc-thread')
      return 'settled in ' + (i + 1) + 's :: ' + (text.match(/completed|failed|cancelled/i) ?? ['?'])[0]
        + ' || last words: ' + (thread ? thread.innerText.split(/\\s+/).join(' ').slice(-160) : 'no thread')
    }
  }
  return 'still running after ${waitSeconds}s'
})()`

const STOP_MIDWAY = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Count slowly from 1 to 200, one number per line, and explain each one.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  // Let it genuinely start before changing our mind about it.
  let started = false
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (document.querySelector('button[aria-label^="Stop the running"]')) { started = true; break }
  }
  if (!started) return 'it never started, so there was nothing to stop'
  await new Promise((r) => setTimeout(r, 2500))
  const stop = document.querySelector('button[aria-label^="Stop the running"]')
  if (!stop) return 'the stop control vanished before it could be pressed'
  stop.click()
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    if (/completed|failed|cancelled|stopped/i.test(text)) {
      const thread = document.querySelector('.lc-thread')
      return 'stopped after ' + (i + 1) + 's :: header says "' + (text.match(/completed|failed|cancelled|stopped/i) ?? ['?'])[0]
        + '" || thread tail: ' + (thread ? thread.innerText.split(/\\s+/).join(' ').slice(-150) : 'none')
    }
  }
  return 'pressed stop and it never settled'
})()`

const SET_ASK = `(async () => {
  const mode = [...document.querySelectorAll('.lc-control')].find((b) => /ask|accept|approve/i.test(b.innerText))
  if (!mode) return 'no mode control'
  mode.click()
  await new Promise((r) => setTimeout(r, 500))
  const item = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button')].find((b) => b.innerText.trim().toLowerCase().startsWith('ask'))
  if (!item) return 'no Ask option'
  item.click()
  await new Promise((r) => setTimeout(r, 600))
  return [...document.querySelectorAll('.lc-control')].map((c) => c.innerText.split(/\\s+/).join(' ').trim()).join(' | ')
})()`

try {
  await drive.capture('a free model, no account needed', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Message Wren')
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('1. ask it something', () =>
    drive.evaluate(send('Remember this word: PORTCULLIS. Reply with only the word OK.', 180))
  )

  await drive.capture('2. follow up — does it remember?', () =>
    drive.evaluate(send('What word did I ask you to remember? Reply with only that word.', 180))
  )

  await drive.capture('3. change your mind mid-run', () => drive.evaluate(STOP_MIDWAY))

  await drive.capture('4a. switch to Ask', () => drive.evaluate(SET_ASK))

  await drive.capture('4b. ask it to write anyway', () =>
    drive.evaluate(
      send('Create a file called should-not-exist.txt containing hi. Then say in one line whether you could.', 180)
    )
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'A first ten minutes with the app, on a free model: ask, follow up, stop, and refuse to write.'
  })
}
