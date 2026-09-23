// Is the usage warning said once a conversation?
//
//   LOCUST_SPEND=1 node _tools/drive-usage-once.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23, asked whether "You've used 56% of your 7-day window"
// belongs on every turn or once a conversation: "Once per convo". Two Haiku
// turns in one conversation; the thread counts its usage lines after each.
// Spends two cheap turns. When the account is under the warning line and
// Claude Code sends none, it says so rather than passing.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const drive = await startDrive({
  name: `usage-once-${tag}`,
  port: 9434,
  workspace: await scratchRepository('locust-drive-usage-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const turn = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 180; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]') && !document.querySelector('.lc-livestep')) break
  }
  await new Promise((r) => setTimeout(r, 1500))
  const lines = [...document.querySelectorAll('.lc-thread .lc-diagnostic')].map((node) => node.textContent.trim()).filter((text) => /You've used \\d{1,3}% of your|window is running low/.test(text))
  return JSON.stringify({ lines })
})()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 500)) })()`)
  await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/haiku/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  say(`route: ${route}`)
  const first = JSON.parse(await drive.capture('the first turn', () => drive.evaluate(turn('Reply with exactly: ONE.'))))
  say(`after one turn: ${JSON.stringify(first.lines)}`)
  const second = JSON.parse(await drive.capture('the second turn, same conversation', () => drive.evaluate(turn('Reply with exactly: TWO.'))))
  say(`after two turns: ${JSON.stringify(second.lines)}`)
  if (first.lines.length === 0 && second.lines.length === 0) {
    say('  [SKIP] Claude Code sent no usage warning on either turn -- the account is under the warning line; nothing to count')
  } else {
    check('the thread says the usage warning once, however many turns', second.lines.length === 1, `${String(second.lines.length)} lines: ${second.lines.join(' | ')}`)
  }
  say(failures === 0 ? '\nUSAGE ONCE PASSED' : `\nUSAGE ONCE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "Two Haiku turns in one conversation: how many times the thread gave the usage reading." })
}
