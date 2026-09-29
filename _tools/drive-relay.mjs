// Two teammates talk to each other, and a person watches it happen.
//
//   node _tools/drive-relay.mjs
//
// Wren and Booty, both on the free OpenCode model, replies on. A person
// asks Wren to get a passphrase from Booty. What is seen: Wren's run, then
// Booty's run starting by itself in the sidebar, then the answer landing
// back in Wren's thread with the exchange strip on top.

// `.lc-peer__open` is a class nothing renders any more; the message that
// opens a run is `.lc-peer__bubble.is-link` (PeerThread.tsx), which the
// click path in this drive already uses. Counting the dead one made
// "underlined links: 0" true by construction.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, startDrive, teammateFace, teammateRows, recordRoot } from './drive-lib.mjs'

// `--packaged <exe> --tag <name>`: the same exchange on an installer's build,
// recorded beside the other fixes (0.312, the harness hardening pass).
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `relay-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const CODE = 'TANGERINE'
const workspace = await scratchRepository('locust-drive-relay-ws-')
const drive = await startDrive({
  name: 'relay',
  port: 9295,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
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
    // Every update the host sends the window, kept so the record can say
    // what the relay said even when the screen shows nothing.
    window.__updates = []
    window.desktop.onCodexMissionUpdate(u => { if (u.kind !== 'event') window.__updates.push({ kind: u.kind, message: u.message, teammateId: u.teammateId, startedBy: u.startedBy, phase: u.phase }) })
    const who = ${teammateFace('Wren')}
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
  await drive.capture("the moment Wren's run ends: the thread as it stands, notices included", () => drive.evaluate(`(async () => {
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 4000))
    return (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-300) ?? '') + ' || host updates: ' + JSON.stringify(window.__updates ?? []).slice(0, 700)
  })()`))
  // The host's own words, in full, beside the pictures: a relay that starts
  // nothing and says nothing on screen still leaves its updates here.
  {
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(drive.out, 'host-updates.json'), String(await drive.evaluate(`JSON.stringify(window.__updates ?? [], null, 2)`)), 'utf8')
  }
  await drive.capture("Booty's run starts on its own", () => drive.evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const booty = ${teammateRows()}.find(r => (r.querySelector('.lc-teammate__name, .lc-row__name')?.textContent ?? r.innerText.split('\\n')[0]).trim() === 'Booty')
      if (booty && (/working|running|starting|replying/i.test(booty.innerText) || booty.conversation)) return 'Booty: ' + booty.innerText.replace(/\\s+/g, ' ').slice(0, 160)
    }
    return 'Booty never showed a run in two minutes: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200)
  })()`))
  await drive.capture("open Booty's conversation while it runs", () => drive.evaluate(`(async () => {
    const row = ${teammateRows()}.find(r => /Booty/.test(r.innerText))
    const conversation = row && row.conversation
    if (conversation) conversation.click()
    await new Promise(r => setTimeout(r, 800))
    return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no header') + ' || ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? '')
  })()`))
  await drive.capture('wait for the whole exchange to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      // "listening" is Wren waiting for the reply-back turn, "thinking" is a run
      // between tool calls: both are the exchange still going.
      if (i > 20 && !document.querySelector('button[aria-label^="Stop the running"]') && !${teammateRows()}.some(r => /working|running|starting|replying|listening|thinking|waiting/i.test(r.innerText))) return 'settled: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200)
    }
    return 'still going'
  })()`))
  await drive.capture("Wren's thread: what Wren sent, and Booty's answer", () => drive.evaluate(`(async () => {
    const row = ${teammateRows()}.find(r => /Wren/.test(r.innerText))
    const conversation = row && row.conversation
    if (conversation) conversation.click()
    await new Promise(r => setTimeout(r, 900))
    for (const toggle of document.querySelectorAll('.lc-peer:not(.is-open) .lc-peer__toggle')) toggle.click()
    await new Promise(r => setTimeout(r, 400))
    const strip = document.querySelector('.lc-exchange')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no exchange strip'
    const messages = [...document.querySelectorAll('.lc-peer__message')].map(m => (m.closest('.lc-peer')?.querySelector('.lc-peer__toggle')?.innerText.replace(/\\s+/g, ' ').trim() ?? '?') + ': ' + (m.querySelector('.lc-peer__bubble')?.innerText.replace(/\\s+/g, ' ').slice(0, 80) ?? ''))
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
  await drive.capture("click Booty's message: it should open Booty's conversation, and no underlined link remains", () => drive.evaluate(`(async () => {
    const links = document.querySelectorAll('.lc-peer__bubble.is-link').length
    const bubble = document.querySelector('.lc-peer__bubble.is-link')
    if (!bubble) return 'no clickable message; underlined links: ' + links
    const title = bubble.getAttribute('title')
    bubble.click()
    await new Promise(r => setTimeout(r, 900))
    const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 60) ?? 'no header'
    // The three surfaces that disagreed after this click: the header, the
    // composer's placeholder, and which teammate card is lit (0.35.0 QA).
    const placeholder = document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
    // A face says it is the one shown with aria-pressed (Sidebar.tsx); the
    // compact rows said it with an aria-current inside them.
    const lit = ${teammateRows()}.find(r => r.face.getAttribute('aria-pressed') === 'true')
    const litName = lit ? lit.innerText.replace(/\\s+/g, ' ').trim().split(' ')[0] : 'none'
    // The three that disagreed lead, because the record's table truncates.
    return 'composer: ' + placeholder + ' || teammate lit: ' + litName + ' || header: ' + header
      + ' || underlined links: ' + links + ' || title: ' + title
  })()`))
  // 0.463: Booty's conversation, started by Wren's message, sits under Wren's in the sidebar.
  await drive.capture("the sidebar: Booty's conversation under Wren's", () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 1500))
    const nests = [...document.querySelectorAll('.lc-convnest')]
    const said = nests.map((nest) => 'NESTED ' + nest.innerText.replace(/\\s+/g, ' ').slice(0, 50) + ' UNDER ' + (nest.previousElementSibling?.innerText.replace(/\\s+/g, ' ').slice(0, 50) ?? '?'))
    return (nests.length === 1 ? 'PASS ' : 'FAIL ') + nests.length + ' nested || ' + said.join(' | ') + ' || top rows: ' + document.querySelectorAll('.lc-convlist > .lc-convrow').length
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: whatever \`pnpm build\` last wrote to out/. Wren and Booty on the free OpenCode model, replies on with a budget of 2. Wren asked to get the passphrase ${CODE} from Booty.` })
}
