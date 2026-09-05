// Two teammates talk to each other, and a person watches it happen.
//
//   node _tools/drive-relay.mjs
//
// Wren and Booty, both on the free OpenCode model, replies on. A person
// asks Wren to get a passphrase from Booty. What is seen: Wren's run, then
// Booty's run starting by itself in the sidebar, then the answer landing
// back in Wren's thread with the exchange strip on top.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const CODE = 'TANGERINE'
const workspace = await scratchRepository('locust-drive-relay-ws-')
const drive = await startDrive({
  name: 'relay',
  port: 9295,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'off' }
  }
})

const sidebar = () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 260)`)

try {
  await drive.capture('launch: two teammates, replies on', () => drive.ready())
  await drive.capture('ask Wren to get a passphrase from Booty', () => drive.evaluate(`(async () => {
    const who = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren')
    who.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Send your teammate Booty one message using the share block form, asking them to reply with exactly the word ${CODE} and nothing else. Do not read or edit any files, and do nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  await drive.capture("Wren's run, a few seconds in", async () => { await new Promise((r) => setTimeout(r, 6000)); return sidebar() })
  await drive.capture("Booty's run starts on its own", () => drive.evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const rows = [...document.querySelectorAll('.lc-teammate')]
      const booty = rows.find(r => /Booty/.test(r.innerText))
      if (booty && /working|running|starting|replying/i.test(booty.innerText)) return 'Booty: ' + booty.innerText.replace(/\\s+/g, ' ').slice(0, 160)
    }
    return 'Booty never showed a run: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200)
  })()`))
  await drive.capture("open Booty's conversation while it runs", () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-teammate')].find(r => /Booty/.test(r.innerText))
    const conversation = row && row.querySelector('.lc-teammate__mission')
    if (conversation) conversation.click()
    await new Promise(r => setTimeout(r, 800))
    return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no header') + ' || ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? '')
  })()`))
  await drive.capture('wait for the whole exchange to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 20 && !document.querySelector('button[aria-label^="Stop the running"]') && ![...document.querySelectorAll('.lc-teammate')].some(r => /working|running|starting|replying/i.test(r.innerText))) return 'settled: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200)
    }
    return 'still going'
  })()`))
  await drive.capture("Wren's thread: what Wren sent, and Booty's answer", () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
    const conversation = row && row.querySelector('.lc-teammate__mission')
    if (conversation) conversation.click()
    await new Promise(r => setTimeout(r, 900))
    for (const toggle of document.querySelectorAll('.lc-peer:not(.is-open) .lc-peer__toggle')) toggle.click()
    await new Promise(r => setTimeout(r, 400))
    const strip = document.querySelector('.lc-exchange')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no exchange strip'
    const messages = [...document.querySelectorAll('.lc-peer__message')].map(m => (m.querySelector('.lc-peer__author')?.innerText ?? '?') + ': ' + (m.querySelector('.lc-peer__bubble')?.innerText.replace(/\\s+/g, ' ').slice(0, 80) ?? ''))
    return 'strip: ' + strip + ' || ' + messages.join(' | ') + ' || passphrase seen: ' + /${CODE}/.test(document.querySelector('.lc-thread')?.innerText ?? '')
  })()`))
  await drive.capture('scroll the thread to its end', () => drive.evaluate(`(async () => {
    const thread = document.querySelector('.lc-thread')
    let box = thread
    while (box && !(box.scrollHeight > box.clientHeight + 4)) box = box.parentElement
    if (box) box.scrollTop = box.scrollHeight
    await new Promise(r => setTimeout(r, 300))
    return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-260) ?? ''
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: whatever \`pnpm build\` last wrote to out/. Wren and Booty on the free OpenCode model, replies on with a budget of 2. Wren asked to get the passphrase ${CODE} from Booty.` })
}
