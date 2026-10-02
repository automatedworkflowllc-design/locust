// Two conversations with one teammate, running at once (0.551).
//
//   node _tools/drive-two-conversations-one-teammate.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: "we should 100% be able to have multiple convos with the
// same teammate going". Until 0.551 a second conversation with a busy teammate
// queued ("Sends when Ash finishes"). Ash (free) is asked one thing; while that
// runs, "New conversation with Ash" from Ash's face, a second thing. Both must run as separate
// conversations, neither queued. Spends nothing.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-two-convos-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `two-conversations-${tag}`,
  port: 9822,
  workspace,
  outPath: join(recordRoot('two-conversations-one-teammate-2026-10-02'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  say(String(await drive.evaluate(openTeammateScript('Ash'))))
  const first = String(await drive.capture('Ash, the first thing', () => drive.evaluate(sendAndWaitScript('Write a 400-word description of a lighthouse at dusk. Use no tools.', { settle: false }))))
  check('the first was sent', first === 'sent', first)
  const second = JSON.parse(String(await drive.capture('Home, Ash again, the second thing', () => drive.evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 1200))
    const runningBefore = !!document.querySelector('button[aria-label^="Stop the running"]')
    // The way a person starts another one: the face's flyout, "New conversation with Ash".
    const face = [...document.querySelectorAll('.lc-faces__one')].find((one) => (one.getAttribute('aria-label') ?? '').includes('Ash'))
    face?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    let item
    for (let i = 0; i < 20 && !item; i += 1) {
      await new Promise((r) => setTimeout(r, 200))
      item = [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === 'New conversation with Ash')
    }
    item?.click()
    await new Promise((r) => setTimeout(r, 600))
    const opened = item ? 'flyout' : 'no flyout item; faces: ' + [...document.querySelectorAll('.lc-faces__one')].map((one) => one.getAttribute('aria-label')).join(' | ')
    const placeholder = document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? ''
    const sent = await ${sendAndWaitScript('Reply with only the word PONG. Use no tools.', { settle: false })}
    await new Promise((r) => setTimeout(r, 2500))
    const text = document.body.innerText
    return JSON.stringify({ runningBefore, opened, placeholder, sent, queued: /Sends when Ash finishes/.test(text), running: (document.querySelector('.lc-titlebar, header')?.innerText ?? text).match(/(\\d) running/)?.[1] ?? null })
  })()`))))
  say(JSON.stringify(second))
  check('the first was still running when the second began', second.runningBefore === true, JSON.stringify(second))
  check('the second was addressed to Ash as a new conversation', /^Message Ash/.test(second.placeholder), second.placeholder)
  check('the second was sent, not queued behind the first', second.sent === 'sent' && second.queued === false, JSON.stringify(second))
  // Both settle.
  await drive.evaluate(`(async () => { for (let i = 0; i < 480; i += 1) { await new Promise((r) => setTimeout(r, 500)); if (!/\\d running/.test(document.body.innerText)) break } })()`)
  const ledger = join(drive.profile, 'mission-ledger')
  const missions = []
  for (const name of (await readdir(ledger).catch(() => [])).filter((one) => one.startsWith('mission_'))) {
    const text = await readFile(join(ledger, name), 'utf8').catch(() => '')
    missions.push({ lighthouse: text.includes('lighthouse'), pong: text.includes('PONG'), completed: text.includes('"run.completed"'), continues: /"continuesFrom":\{/.test(text) })
  }
  say(JSON.stringify(missions))
  check('two missions recorded', missions.length === 2, JSON.stringify(missions))
  check('each its own conversation (neither continues the other)', missions.every((mission) => !mission.continues), JSON.stringify(missions))
  check('both answered', missions.filter((mission) => mission.completed).length === 2, JSON.stringify(missions))
  const roster = JSON.parse(await readFile(join(drive.profile, 'teammates.json'), 'utf8').catch(() => '{}'))
  const owners = Object.values(roster.missionOwners ?? {})
  check('both are Ash\'s', owners.length === 2 && owners.every((owner) => owner === 'tm_ash'), JSON.stringify(roster.missionOwners))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash, free, two conversations at once.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
