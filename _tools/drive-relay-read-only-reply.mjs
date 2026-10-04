// A read-only recipient of a relayed message answers it instead of trying a command (0.592).
//
//   node _tools/drive-relay-read-only-reply.mjs [--packaged <exe>] [--tag <name>] [--recipient antigravity|opencode] [--runs 2]
//
// Handoff review finding (a), 2026-10-03: Bro, in Ask, received Codex's reply,
// tried a command, was refused by the mode, and wrote NOTHING back. The reply
// brief now tells a read-only recipient that what it was sent is quoted, that
// a shell command is refused and ends the run with nothing written, and to
// answer from the quote and its read tools. Wren (free OpenCode, Accept edits)
// asks Booty for a passphrase; Booty replies in Ask -- on Antigravity Flash
// (the failing case) or, with --recipient opencode, on the free OpenCode model.
// Each run must end with the passphrase back in Wren's thread. Spends: Flash
// turns on the Antigravity account when that recipient is chosen; nothing
// otherwise.

import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const recipientKind = arg('--recipient') ?? 'antigravity'
const runs = Number(arg('--runs') ?? 2)
const CODES = ['TANGERINE', 'MARIGOLD', 'PERSIMMON', 'CLEMENTINE']
const BOOTY_ROUTE = recipientKind === 'opencode' ? { ...FREE_ROUTE, mode: 'ask' } : { runtime: 'antigravity', model: 'flash', mode: 'ask' }

const results = []
for (let n = 0; n < runs; n += 1) {
  const CODE = CODES[n % CODES.length]
  const workspace = await scratchRepository('locust-drive-relay-ro-ws-')
  const drive = await startDrive({
    name: `relay-read-only-reply-${tag}-${String(n + 1)}`,
    port: 9859,
    // Antigravity Flash is a real account's quota: the drive says so (LOCUST_SPEND=1 to run it).
    // A drive that did not was refused the route and measured nothing (the first control run).
    spends: recipientKind !== 'opencode',
    workspace,
    outPath: join(recordRoot('relay-read-only-reply-2026-10-04'), `${tag}-${recipientKind}-${String(n + 1)}`),
    ...(packaged === undefined ? {} : { packaged }),
    seed: {
      schemaVersion: 1,
      teammates: [
        { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE },
        { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-05T05:00:00.000Z', route: BOOTY_ROUTE }
      ],
      missionOwners: {},
      settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'off', autoMode: false }
    }
  })
  const one = { run: n + 1, code: CODE, sent: '', bootyRan: '', settled: '', back: '', bootyThread: '' }
  try {
    await drive.ready()
    one.sent = String(await drive.capture(`run ${String(n + 1)}: ask Wren to get the passphrase from Booty`, () => drive.evaluate(`(async () => {
      ${teammateFace('Wren')}.click()
      await new Promise((r) => setTimeout(r, 500))
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Send your teammate Booty one message using the share block form, telling them that the word of the day is ${CODE} and asking them to reply with exactly that word and nothing else. Do not read or edit any files, and do nothing else.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 250))
        const button = document.querySelector('button[aria-label="Send"]')
        if (button && !button.disabled) { button.click(); return 'sent' }
      }
      return 'no send'
    })()`)))
    one.bootyRan = String(await drive.capture("Booty's run starts on its own", () => drive.evaluate(`(async () => {
      for (let i = 0; i < 360; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
        const booty = ${teammateRows()}.find((r) => r.name === 'Booty')
        if (booty && (/working|running|starting|replying|thinking|writing/i.test(booty.activity ?? '') || booty.conversation)) return 'Booty: ' + (booty.activity ?? '') + (booty.conversation ? ' (conversation)' : '')
      }
      return 'Booty never showed a run in three minutes'
    })()`)))
    one.settled = String(await drive.capture('wait for the whole exchange to settle', () => drive.evaluate(`(async () => {
      for (let i = 0; i < 960; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
        if (i > 20 && !document.querySelector('button[aria-label^="Stop the running"]') && !${teammateRows()}.some((r) => /working|running|starting|replying|listening|thinking|waiting|writing/i.test(r.activity ?? ''))) return 'settled after ' + String(Math.round(i / 2)) + ' s'
      }
      return 'still going after 8 minutes'
    })()`)))
    one.bootyThread = String(await drive.capture("Booty's conversation: what the reply run did", () => drive.evaluate(`(async () => {
      const row = ${teammateRows()}.find((r) => r.name === 'Booty')
      if (row && row.conversation) row.conversation.click()
      await new Promise((r) => setTimeout(r, 900))
      return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-600) ?? 'no thread'
    })()`)))
    one.back = String(await drive.capture("Wren's thread: the passphrase back", () => drive.evaluate(`(async () => {
      const row = ${teammateRows()}.find((r) => r.name === 'Wren')
      if (row && row.conversation) row.conversation.click()
      await new Promise((r) => setTimeout(r, 900))
      for (const toggle of document.querySelectorAll('.lc-peer:not(.is-open) .lc-peer__toggle')) toggle.click()
      await new Promise((r) => setTimeout(r, 400))
      // Wren's own message carries the passphrase too: only a message FROM Booty counts.
      const messages = [...document.querySelectorAll('.lc-peer')].map((peer) => ({
        who: peer.querySelector('.lc-peer__toggle')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) ?? '?',
        text: peer.querySelector('.lc-peer__message')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120) ?? ''
      }))
      const fromBooty = messages.filter((m) => /Booty/.test(m.who) && !/to Booty/.test(m.who) && m.text.length > 0)
      return JSON.stringify({ wroteBack: fromBooty.length > 0, wordBack: fromBooty.some((m) => m.text.includes('${CODE}')), messages })
    })()`)))
  } catch (error) {
    one.settled = `drive failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Run ${String(n + 1)} of ${String(runs)}: Wren (free OpenCode) asks Booty (${recipientKind}, Ask) for ${CODE}.`, extra: JSON.stringify(one).slice(0, 900) })
  }
  const back = (() => { try { return JSON.parse(one.back) } catch { return { wroteBack: false, wordBack: false, messages: [] } } })()
  // The finding was SILENCE after a refused command. PASS = Booty ran, did not end on the refusal, and a
  // message FROM Booty came back (Wren's own message carries the word too, so it never counts). Whether the
  // word itself came back is reported beside it: Flash in Ask may decline to echo a token on principle,
  // which is an answer, not the silence this measures.
  const stoppedOnRefusal = /It stopped there\. Antigravity was not allowed to run a command in this mode\.\s*$/.test(one.bootyThread.replace(/Thought for.*$/, '').trim()) || /was not allowed to run a command in this mode\.[^]*ran [a-z]+ .*refused\s*$/.test(one.bootyThread)
  const ok = /^Booty: /.test(one.bootyRan) && back.wroteBack === true && !stoppedOnRefusal
  results.push({ ...one, ok, wordBack: back.wordBack === true })
  say(`  [${ok ? 'PASS' : 'FAIL'}] run ${String(n + 1)}: ${ok ? 'Booty wrote back' : 'Booty did not write back'}${back.wordBack ? ', with the word' : ''} -- Booty ${one.bootyRan}; ${one.settled}; Booty's thread ends: ${one.bootyThread.slice(-220)}`)
}
const passed = results.filter((one) => one.ok).length
say(`${String(passed)}/${String(results.length)} read-only ${recipientKind} replies wrote back (${String(results.filter((one) => one.wordBack).length)} with the word)`)
process.exit(passed === results.length ? 0 : 1)
