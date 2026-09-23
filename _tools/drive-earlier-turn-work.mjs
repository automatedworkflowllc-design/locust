// What happens to a turn's work when you send the NEXT message?
//
//   node _tools/drive-earlier-turn-work.mjs
//
// Colin, 2026-09-08: "the thoughts and tool calls disappear after an agent is
// done, probably for posterity and user experience we want that to stay so
// they can see after the fact or if they missed it."
//
// A single finished turn keeps its work on screen -- driven and confirmed
// (docs/user-session/2026-09-08T14-05-19-work-survives). `openByDefault` is
// set only for the LATEST turn, though (missionView.ts:1129), so this drives
// the case that phrase points at: two turns, and what is left of the first
// once the second exists.
//
// Free OpenCode model. Two short turns, both needing real tool use.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-earlier-ws-')
const drive = await startDrive({
  name: 'earlier-turn-work',
  port: 9395,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const send = (text) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Mission instruction"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 150; i += 1) {
    await new Promise(r => setTimeout(r, 2000))
    const head = document.querySelector('.lc-workroom__head, header')?.textContent ?? ''
    if (!/running|starting/i.test(head)) return 'done'
  }
  return 'still running'
})()`

/** Every fold on screen, and whether its rows are actually visible. */
const folds = `(() => {
  const cards = [...document.querySelectorAll('.lc-card')].filter(c => c.querySelector('.lc-activity'))
  return JSON.stringify(cards.map((card, index) => ({
    turn: index + 1,
    trace: card.querySelector('.lc-activity')?.textContent?.replace(/\\s+/g, ' ').trim(),
    expanded: card.querySelector('.lc-activity')?.getAttribute('aria-expanded'),
    rowsVisible: card.querySelectorAll('.lc-filerow').length
  })), null, 1)
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open a mission on a free model', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('turn one, which uses tools', () => drive.evaluate(send('List every file in this folder. Use your tools.')))
  await drive.capture('after turn one: its work is on screen', () => drive.evaluate(folds))

  await drive.capture('turn two', () => drive.evaluate(send('Now read README.md and quote its first line.')))
  await drive.capture('THE QUESTION: what is left of turn one', () => drive.evaluate(folds))

  await drive.capture('can turn one be opened again by hand', () => drive.evaluate(`(async () => {
    const cards = [...document.querySelectorAll('.lc-card')].filter(c => c.querySelector('.lc-activity'))
    const first = cards[0]?.querySelector('.lc-activity')
    if (!first) return 'no first fold'
    if (first.getAttribute('aria-expanded') === 'true') return 'it was already open'
    first.click()
    await new Promise(r => setTimeout(r, 500))
    return 'after clicking it: rows visible = ' + cards[0].querySelectorAll('.lc-filerow').length
  })()`))
  // THE fact that decides how big the correct fix is. If a fold the person
  // opened BY HAND also closes when the next message is sent, then the whole
  // turn is being remounted and no amount of defaulting inside the card can
  // hold it -- the state has to live above the thread.
  await drive.capture('a fold opened BY HAND, then another message', async () => {
    await drive.evaluate(send('Say OK.'))
    return drive.evaluate(folds)
  })

} finally {
  await drive.finish({
    intro: 'Whether an earlier turn keeps its tool calls once a later turn exists, and what it costs to get them back.'
  })
}

say('done')
