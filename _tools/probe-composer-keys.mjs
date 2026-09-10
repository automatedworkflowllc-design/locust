// The two keys a person presses without thinking.
//
//   node _tools/probe-composer-keys.mjs
//
// Ported from Claude Code, which is where the habit comes from:
//
//   up arrow   brings back what you last sent, so you can resend it with a
//              word changed. One of the highest-frequency keys in the whole
//              program.
//   escape     stops the run.
//
// Locust bound both only while the SLASH MENU was open, so on an empty
// composer neither did anything at all.
//
// Driven rather than unit-tested, because a keyboard affordance that passes a
// test and does nothing on screen is the exact mistake this session already
// made once: 0.56.0 shipped a feature whose two halves each had a passing
// test and which was invisible on every runtime.
//
// FREE: one short run on the free OpenCode model, stopped early on purpose.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-keys-ws-')
const drive = await startDrive({
  name: 'composer-keys',
  port: 9452,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** A real key press on the composer, the way a keyboard sends one. */
const press = (key) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer'
  field.focus()
  field.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 300))
  return field.value
})()`

const typeInto = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  return field.value
})()`

try {
  await drive.capture('launch and open Wren', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 600))
      return document.querySelector('form.command-dock textarea') === null ? 'no composer' : 'opened'
    })()`)
  })

  // The premise, outside capture(): no composer, no keys to press, and every
  // step below would report an empty string as a considered answer.
  const ready = await drive.evaluate(`document.querySelector('form.command-dock textarea') !== null`)
  if (ready !== true) throw new Error('NOT A KEY TEST: there is no composer on screen')

  await drive.capture('up arrow with nothing sent yet does nothing', () => drive.evaluate(press('ArrowUp')))

  await drive.capture('send one short thing', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly one word: ALPHA. Nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1000))
    return 'composer now: ' + JSON.stringify(document.querySelector('form.command-dock textarea').value)
  })()`))

  await drive.capture('up arrow brings it back', () => drive.evaluate(press('ArrowUp')))
  await drive.capture('down arrow returns to the empty box', () => drive.evaluate(press('ArrowDown')))

  await drive.capture('up arrow does NOT hijack a half-typed line', async () => {
    await drive.evaluate(typeInto('something I am still writing'))
    return drive.evaluate(press('ArrowUp'))
  })

  await drive.capture('escape stops a running mission', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Count from 1 to 2000, one number per line, with no other text.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    let live = false
    for (let i = 0; i < 120 && !live; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) live = true
    }
    if (!live) return 'NOT AN ESCAPE TEST: nothing was running to stop'
    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) {
        return 'stopped after ' + (i * 500) + 'ms'
      }
    }
    return 'STILL RUNNING: escape did not stop it'
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on the free OpenCode model. Up arrow, down arrow and escape pressed on the composer itself.' })
}
