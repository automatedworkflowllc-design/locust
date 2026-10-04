// A teammate stopped mid-reply is said to have stopped, not to have finished (0.572).
//
//   node _tools/drive-a-teammate-stopped-is-said-stopped.mjs [--packaged <exe>]
//
// Colin's ledger, 2026-10-03: Codex hit its usage limit partway through
// Bro's request and Bro's thread read "Codex finished without writing back".
// A limit cannot be met on purpose for free, so this stops the reply the other
// way a run ends early: Wren (free OpenCode) asks Booty for a long essay,
// Booty's run starts by itself, the person stops it, and Wren's thread must
// then say Booty stopped -- which is the host reading the ledger for how the
// run ended, the part a unit test cannot show.

import { join } from 'node:path'

import { FREE_ROUTE, conversationRows, openTeammateScript, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = await scratchRepository('locust-drive-stopped-ws-')
const drive = await startDrive({
  name: 'teammate-stopped',
  port: 9296,
  workspace,
  outPath: join(recordRoot('a-teammate-stopped-2026-10-03'), packaged === undefined ? 'dev' : 'packaged'),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Writer', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'off' }
  }
})
const checks = []
const check = (name, ok, seen) => { checks.push({ name, ok }); say(`  ${ok ? 'PASS' : 'FAIL'} ${name} -- ${seen}`) }

try {
  await drive.capture('launch: two teammates, replies on', () => drive.ready())
  await drive.capture('ask Wren to pass a long writing job to Booty', () => drive.evaluate(`(async () => {
    window.__updates = []
    window.desktop.onCodexMissionUpdate(u => { if (u.kind !== 'event') window.__updates.push({ kind: u.kind, message: u.message }) })
    const opened = await ${openTeammateScript('Wren')}
    if (!/^opened/.test(opened)) return 'not sent: ' + opened
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Send your teammate Booty one message using the share block form, asking them to write a 1,500-word essay on the history of the locust, in their reply, and to tell you when it is done. Do not read or edit any files, and do nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  const started = String(await drive.capture("Booty's run starts by itself; open it", () => drive.evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const booty = ${conversationRows()}.find(r => r.owner === 'tm_booty' && r.running)
      if (booty) {
        booty.click()
        await new Promise(r => setTimeout(r, 1500))
        return 'open: ' + (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 120) ?? '')
      }
    }
    return 'Booty never started: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200)
  })()`)))
  check("Booty's run started from Wren's message", /^open:/.test(started), started)
  const stopped = String(await drive.capture("the person stops Booty's run", () => drive.evaluate(`(async () => {
    for (let i = 0; i < 40; i += 1) {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) { stop.click(); await new Promise(r => setTimeout(r, 4000)); return 'stopped' }
      await new Promise(r => setTimeout(r, 250))
    }
    return 'no stop button: it may have finished already'
  })()`)))
  check("Booty's run was stopped mid-reply", stopped === 'stopped', stopped)
  const wren = JSON.parse(String(await drive.capture("Wren's thread, once Booty's run has ended", () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 4000))
    const row = ${conversationRows()}.find(r => r.owner === 'tm_wren')
    if (row) row.click()
    await new Promise(r => setTimeout(r, 1200))
    const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
    return JSON.stringify({ updates: (window.__updates ?? []).map((u) => u.message).filter(Boolean), said: (thread.match(/Booty (?:stopped|finished)[^.]*\\./g) ?? []) })
  })()`))))
  const all = [...wren.updates, ...wren.said].join(' | ')
  check('Wren is told Booty stopped, and why', /Booty stopped before writing back: the person stopped it\./.test(all), all.slice(0, 400))
  check('nothing says Booty finished', !/Booty finished without writing back/.test(all), all.slice(0, 400))
  check("Wren's thread shows it", wren.said.some((line) => /stopped before writing back/.test(line)), JSON.stringify(wren.said))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const failed = checks.filter((one) => !one.ok).length
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren and Booty on the free OpenCode model; Booty stopped mid-reply: ${String(checks.length - failed)}/${String(checks.length)}.` })
  process.exitCode = failed === 0 && checks.length > 0 ? 0 : 1
}
