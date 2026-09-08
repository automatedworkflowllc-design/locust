// Do the thinking and the tool calls survive the run that produced them?
//
//   node _tools/drive-work-survives.mjs
//
// Colin, 2026-09-08: "the thoughts and tool calls disappear after an agent is
// done, probably for posterity and user experience we want that to stay so
// they can see after the fact or if they missed it."
//
// So this counts what is on screen WHILE a real run works, and counts the same
// things again once it has finished, and prints both. A drive that only looked
// afterwards could not tell "removed when it ended" from "never drawn".
//
// Free OpenCode model, and a prompt that forces real tool use rather than one
// that can be answered from the prompt alone.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-survives-ws-')
const drive = await startDrive({
  name: 'work-survives',
  port: 9393,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Everything on screen that represents work, counted the same way twice. */
const census = `(() => {
  const count = (selector) => document.querySelectorAll(selector).length
  const head = document.querySelector('.lc-workroom__head, header')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  return {
    phase: /running|starting/i.test(head) ? 'running' : 'finished',
    liveStep: count('.lc-livestep, [class*="livestep"]'),
    activityCards: count('.lc-activity'),
    fileRows: count('.lc-filerow'),
    shellRows: count('.lc-filerow.is-shell'),
    traceLine: document.querySelector('.lc-activity__trace, [class*="trace"]')?.textContent?.replace(/\\s+/g, ' ').trim(),
    agentMessages: count('.lc-agentline'),
    bodyMentionsThinking: /thought|thinking/i.test(document.body.innerText)
  }
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open a mission on a free model', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('send something that needs real tool use', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Mission instruction"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'List every file in this folder, then read README.md and tell me its first heading.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return 'sent'
  })()`))

  // WHILE it works. Sampled repeatedly and the richest sample kept, because a
  // single snapshot can land between two steps and see less than was there.
  await drive.capture('WHILE RUNNING: what is on screen', () => drive.evaluate(`(async () => {
    let best = null
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const now = ${census}
      if (now.phase !== 'running') break
      const score = now.fileRows + now.activityCards + now.liveStep
      if (best === null || score > best.score) best = { score, seen: now }
    }
    return JSON.stringify(best === null ? 'never observed running' : best.seen, null, 1)
  })()`))

  await drive.capture('wait for it to finish', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 150; i += 1) {
      await new Promise(r => setTimeout(r, 2000))
      if (${census}.phase === 'finished') return 'finished'
    }
    return 'still running after five minutes'
  })()`))

  await drive.capture('AFTER: is the work still there', () => drive.evaluate(`JSON.stringify(${census}, null, 2)`))

  await drive.capture('AFTER: what the fold says when opened', () => drive.evaluate(`(async () => {
    const fold = [...document.querySelectorAll('button')].find(b => /activity/i.test(b.textContent ?? ''))
    if (!fold) return 'no activity control'
    fold.click()
    await new Promise(r => setTimeout(r, 800))
    return JSON.stringify({
      rowsAfterOpening: document.querySelectorAll('.lc-filerow').length,
      text: document.body.innerText.slice(-600)
    }, null, 1)
  })()`))
} finally {
  await drive.finish({
    intro: 'Whether the thinking and tool calls a run produced are still on screen after it ends, counted during and after.'
  })
}

say('done')
