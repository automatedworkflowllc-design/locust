// Does the thread keep everything a Claude teammate says in one turn?
//
//   LOCUST_SPEND=1 node _tools/drive-claude-says-everything.mjs [--packaged <exe>] [--tag <name>]
//
// A replay of a Bash-heavy Haiku run through Locust's adapter (2026-09-23,
// `_tools/replay-claude-stream.mjs`) found that every message after the first
// replaced the one before -- the block index restarts in each message -- and
// that a subagent's report took the teammate's place. One Haiku turn that
// speaks three times around a command and a subagent; the thread must show
// all three, in order, and never the subagent's word as the teammate's.
// Spends one cheap turn.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const drive = await startDrive({
  name: `claude-says-everything-${tag}`,
  port: 9418,
  workspace: await scratchRepository('locust-drive-says-ws-'),
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

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 500)) })()`)
  await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/haiku/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  say(`route: ${route}`)

  const said = JSON.parse(await drive.capture('one turn that speaks three times', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Do these in order, and say each sentence as its own message. First say exactly: FIRST MESSAGE. Then use the Bash tool to run: echo one. Then say exactly: SECOND MESSAGE. Then use the Task tool once, and wait for it, to ask a subagent to reply with exactly the word ZEBRA and nothing else. Then say exactly: THIRD MESSAGE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    field.form.requestSubmit()
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const allow = [...document.querySelectorAll('button')].find((b) => /^(Approve|Allow) once$/.test(b.innerText.trim()))
      if (allow) allow.click()
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]') && !document.querySelector('.lc-livestep')) break
    }
    await new Promise((r) => setTimeout(r, 1500))
    const messages = [...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((node) => node.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify({ messages })
  })()`)))
  say(`teammate's messages: ${JSON.stringify(said.messages)}`)
  const all = said.messages.join(' | ')
  check('all three things it said are in the thread', /FIRST MESSAGE/.test(all) && /SECOND MESSAGE/.test(all) && /THIRD MESSAGE/.test(all), all.slice(0, 200))
  check('in the order it said them', all.indexOf('FIRST') < all.indexOf('SECOND') && all.indexOf('SECOND') < all.indexOf('THIRD'))
  check("the subagent's word is never the teammate's", !said.messages.some((message) => /^\W*ZEBRA\W*$/.test(message) || /ZEBRA\W*(FIRST|SECOND|THIRD)/.test(message)), all.slice(0, 200))
  say(failures === 0 ? '\nCLAUDE SAYS EVERYTHING PASSED' : `\nCLAUDE SAYS EVERYTHING: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One Haiku turn that speaks three times around a command and a subagent: what the thread kept.' })
}
