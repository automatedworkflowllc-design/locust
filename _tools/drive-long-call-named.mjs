// What the live line says while a Claude Code call runs for a while.
//
//   LOCUST_SPEND=1 node _tools/drive-long-call-named.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23, with a frame of a Claude run eight minutes in: the live
// line read "Using a tool... Bash" the whole time -- "i find it hard to
// believe from using this app that after 8 minutes of working thats the only
// info the user has been given". Claude Code's start names the tool only; the
// command and its description came with the call's end.
//
// One Haiku turn that runs a fifteen-second command. Approves it if asked
// (Edit mode may ask before a command), then reads the live line once a second
// until the run ends, and keeps every label it saw. Spends one cheap turn.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const drive = await startDrive({
  name: `long-call-named-${tag}`,
  port: 9416,
  workspace: await scratchRepository('locust-drive-longcall-ws-'),
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

  const seen = JSON.parse(await drive.capture('a fifteen-second command, the live line read every second', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Use the Bash tool once to run exactly: sleep 15 && echo finished . Give it the description "Wait fifteen seconds". Then reply with the word DONE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    field.form.requestSubmit()
    const labels = []
    let approved = false
    for (let i = 0; i < 150; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const allow = [...document.querySelectorAll('button')].find((b) => /^(Approve|Allow) once$/.test(b.innerText.trim()))
      if (allow && !approved) { allow.click(); approved = true; continue }
      // The whole live line: the register word, then the step's own name.
      const label = document.querySelector('.lc-livestep')?.innerText.replace(/\\s+/g, ' ').trim()
      if (label && labels.at(-1) !== label) labels.push(label)
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]') && !document.querySelector('.lc-livestep')) break
    }
    return JSON.stringify({ approved, labels })
  })()`)))
  say(`labels seen: ${JSON.stringify(seen.labels)}`)
  // Claude Code may allow a harmless command without asking; either way it ran.
  check('the command ran', seen.labels.some((label) => /tool|fifteen|sleep/i.test(label)), JSON.stringify(seen.labels))
  check('while it ran, the live line said what it was for -- not only "Bash"', seen.labels.some((label) => /fifteen/i.test(label)), JSON.stringify(seen.labels))
  say(failures === 0 ? '\nLONG CALL NAMED PASSED' : `\nLONG CALL NAMED: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'A fifteen-second Bash call on Haiku, approved, and what the live line said while it ran.' })
}
