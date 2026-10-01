// Slash commands in the composer.
//
//   node _tools/drive-slash.mjs
//
// The unit tests decide which commands exist and which are offered. What they
// cannot decide is whether typing `/` in the real box shows anything, whether
// Enter runs the highlighted command or sends "/plan" to a teammate, and
// whether the menu is legible where it lands. That is what this drives.
//
// No mission is sent, so nothing is spent: every command here maps to a
// control on the composer row, and changing a mode costs nothing.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-slash-ws-')
const drive = await startDrive({
  name: 'slash',
  port: 9381,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Type into the box the way React sees it: the native setter, then input. */
const typeScript = (text) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Message"]')
  if (!box) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 350))
  const menu = document.querySelector('.lc-slash')
  if (!menu) return 'NO MENU for ' + ${JSON.stringify(text)}
  const box2 = menu.getBoundingClientRect()
  const rows = [...menu.querySelectorAll('.lc-slash__item')].map(item => ({
    name: item.querySelector('.lc-slash__name')?.textContent,
    detail: item.querySelector('.lc-slash__detail')?.textContent,
    active: item.classList.contains('is-active')
  }))
  return JSON.stringify({
    inWindow: box2.left >= 0 && box2.right <= window.innerWidth && box2.top >= 0 && box2.bottom <= window.innerHeight,
    height: Math.round(box2.height),
    rows
  }, null, 1)
})()`

/** A real key, so the composer's own handler decides what Enter means. */
const keyScript = (key) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Message"]')
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  const menu = document.querySelector('.lc-slash')
  const active = menu ? [...menu.querySelectorAll('.lc-slash__item')].find(i => i.classList.contains('is-active')) : undefined
  return JSON.stringify({
    boxText: box.value,
    menuOpen: menu !== null,
    highlighted: active?.querySelector('.lc-slash__name')?.textContent ?? null,
    mode: document.querySelector('button[aria-label="Permission mode"]')?.textContent?.trim() ?? null
  }, null, 1)
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open a mission on a runtime with every mode', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok', row: '/grok/i' }))
  })

  await drive.capture('the mode before any command', () => drive.evaluate(`
    document.querySelector('button[aria-label="Permission mode"]')?.textContent?.trim() ?? 'no mode control'
  `))

  await drive.capture('a bare slash opens the menu', () => drive.evaluate(typeScript('/')))
  await drive.capture('typing narrows it', () => drive.evaluate(typeScript('/a')))

  // THE test. "run /plan on this" is a message that contains a slash. If the
  // menu opens for it, a sentence someone meant to send becomes a mode change.
  await drive.capture('a slash inside a sentence is not a command', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'run /plan on this file')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 350))
    return document.querySelector('.lc-slash') === null ? 'no menu, correct' : 'MENU OPENED ON A SENTENCE'
  })()`))

  await drive.capture('back to a command, and arrow down', async () => {
    await drive.evaluate(typeScript('/'))
    return drive.evaluate(keyScript('ArrowDown'))
  })

  // Enter must run the command, not send it. A teammate receiving the literal
  // text "/plan" is the one outcome this feature exists to prevent.
  await drive.capture('Enter runs it and does not send it', () => drive.evaluate(keyScript('Enter')))

  await drive.capture('the composer afterwards', () => drive.evaluate("document.querySelector('textarea[aria-label=\"Message\"]')?.value === '' ? 'box cleared' : 'box still has text'"))
} finally {
  await drive.finish({
    intro: 'Slash commands in the composer: whether typing `/` shows a menu, whether a slash inside a sentence is left alone, and whether Enter runs the highlighted command instead of sending it.'
  })
}

say('done')
