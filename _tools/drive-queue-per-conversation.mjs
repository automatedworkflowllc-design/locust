// Two teammates working at once, a message queued for each: does each stay
// with its own conversation, and go to its own teammate, once?
//
//   node _tools/drive-queue-per-conversation.mjs [--packaged <exe>] [--tag <name>] [--model <words>]
//
// The outside beta recheck of 0.299 (2026-09-23, P1): a line queued for Pip
// while Pip worked showed under Gem's thread too, reading "sends when Gem
// finishes", and Edit there rewrote Pip's. The queue was one list for every
// conversation: the box under any thread showed its first row, Edit and
// Discard emptied all of it, and the fold that joins lines typed during one
// run joined lines typed for two teammates -- so one could be sent the
// other's instruction.
//
// This is the reviewer's own test. Pip and Gem each start a long run (a dozen
// files, one at a time); a line is queued for each; Gem's is edited; then
// each conversation is opened in turn until both have finished, and what each
// teammate was sent is read back from its own thread and from the files.
// Last, a run that is stopped keeps its queued line to itself. Free model;
// spends nothing.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const MODEL = arg('--model') ?? 'lightning'
const OUT = join(new URL('../docs/beta-fixes-2026-09-23/', import.meta.url).pathname.slice(1), `queue-per-conversation-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-queue-two-ws-')
const drive = await startDrive({
  name: `queue-per-conversation-${tag}`,
  port: 9443,
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_pip', name: 'Pip', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-05T05:01:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const type = (text) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Mission instruction"]')
  if (!box) return 'no box'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 250))
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'sent'
})()`

// Whose thread is on screen, whether it is running, what its box says is NEXT,
// and what the person has said in it.
const STATE = `(() => JSON.stringify({
  who: (document.querySelector('.lc-workroom__name')?.textContent ?? '').trim(),
  running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
  next: document.querySelector('.lc-queued .lc-queued__text')?.textContent ?? null,
  note: document.querySelector('.lc-queued .lc-queued__note')?.textContent ?? null,
  said: [...document.querySelectorAll('.lc-thread .lc-bubble')].map((node) => node.textContent.trim())
}))()`
const state = async () => JSON.parse(String(await drive.evaluate(STATE)))

const open = async (name) => {
  await drive.evaluate(`(async () => { ${teammateFace(name)}?.click(); await new Promise((r) => setTimeout(r, 1200)) })()`)
  const now = await state()
  if (!now.who.startsWith(name)) say(`  (opening ${name} shows ${JSON.stringify(now.who)})`)
  return now
}

const pickFree = async () => {
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: MODEL, row: `/${MODEL}/i` }))
  const route = String(await drive.evaluate(`(() => {
    const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
    return (c?.textContent ?? '').trim()
  })()`))
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`route is ${JSON.stringify(route)} -- refusing anything but a free OpenCode model`)
  return route
}

const untilRunning = async () => {
  for (let waited = 0; waited < 60_000; waited += 500) {
    if ((await state()).running) return true
    await sleep(500)
  }
  return false
}

const LONG = (who) =>
  `Create the files notes/${who}-01.txt through notes/${who}-12.txt, one at a time, each containing only its own number. Do nothing else. Then say ${who.toUpperCase()} FIRST.`
const QUEUED = (token, file) => `Create notes/${file}.txt containing only the word ${token}. Then say ${token} DONE.`

const count = (lines, token) => lines.filter((line) => line.includes(token)).length

try {
  await drive.ready()
  await drive.resize(1215, 800)

  // Pip starts a long run, and a line is queued behind it.
  await open('Pip')
  say(`Pip's route: ${await pickFree()}`)
  await drive.capture('Pip starts a long run', () => drive.evaluate(type(LONG('pip'))))
  check("Pip's run is under way", await untilRunning())
  const pipQueued = await drive.capture('a line queued for Pip', async () => {
    await drive.evaluate(type(QUEUED('PIP_QUEUED', 'pip-queued')))
    await sleep(800)
    return drive.evaluate(STATE)
  })
  const afterPip = JSON.parse(String(pipQueued))
  check("Pip's box shows Pip's line as NEXT", (afterPip.next ?? '').includes('PIP_QUEUED'), afterPip.next)

  // Gem starts a long run of their own.
  await open('Gem')
  say(`Gem's route: ${await pickFree()}`)
  await drive.capture('Gem starts a long run', () => drive.evaluate(type(LONG('gem'))))
  check("Gem's run is under way", await untilRunning())
  const gemBefore = await drive.capture("Gem's box, before anything is queued for Gem", () => drive.evaluate(STATE))
  const gemFirst = JSON.parse(String(gemBefore))
  check("Gem's box does not show Pip's line", !(gemFirst.next ?? '').includes('PIP_QUEUED'), `NEXT: ${JSON.stringify(gemFirst.next)} ${JSON.stringify(gemFirst.note)}`)

  // A line for Gem, then edited.
  const gemQueued = await drive.capture('a line queued for Gem', async () => {
    await drive.evaluate(type(QUEUED('GEM_QUEUED', 'gem-queued')))
    await sleep(800)
    return drive.evaluate(STATE)
  })
  const afterGem = JSON.parse(String(gemQueued))
  check("Gem's NEXT is Gem's line alone", (afterGem.next ?? '').includes('GEM_QUEUED') && !(afterGem.next ?? '').includes('PIP_QUEUED'), JSON.stringify(afterGem.next))
  const edited = await drive.capture("Gem's line edited", async () => {
    await drive.evaluate(`(() => { [...document.querySelectorAll('.lc-queued button')].find((b) => b.textContent.trim() === 'Edit')?.click() })()`)
    await sleep(500)
    const inBox = String(await drive.evaluate(`document.querySelector('textarea[aria-label="Mission instruction"]')?.value ?? ''`))
    say(`  Edit put back in the box: ${JSON.stringify(inBox)}`)
    await drive.evaluate(type(QUEUED('GEM_EDITED', 'gem-queued')))
    await sleep(800)
    return drive.evaluate(STATE)
  })
  const afterEdit = JSON.parse(String(edited))
  check("Gem's NEXT is the edited line", (afterEdit.next ?? '').includes('GEM_EDITED') && !(afterEdit.next ?? '').includes('PIP_QUEUED'), JSON.stringify(afterEdit.next))

  // Back to Pip: Gem's edit changed nothing of Pip's.
  const pipAgain = JSON.parse(String(await drive.capture("Pip's conversation after Gem's edit", async () => {
    await open('Pip')
    return drive.evaluate(STATE)
  })))
  const pipKept = (pipAgain.next ?? '').includes('PIP_QUEUED') || count(pipAgain.said, 'PIP_QUEUED') === 1
  check("Pip's line is still Pip's own -- queued, or already sent to Pip", pipKept && !(pipAgain.next ?? '').includes('GEM'), `NEXT ${JSON.stringify(pipAgain.next)}; said ${JSON.stringify(pipAgain.said)}`)

  // Let each finish, opening each conversation until its queue has gone and
  // its runs settled. Only a read of THAT teammate's thread counts: a read
  // taken while another conversation was on screen is the other one's.
  const readAs = async (name) => {
    for (let tries = 0; tries < 6; tries += 1) {
      const now = await open(name)
      if (now.who.startsWith(name)) return now
      await sleep(800)
    }
    throw new Error(`could not get ${name}'s conversation on screen`)
  }
  const settle = async (name) => {
    for (let waited = 0; waited < 420_000; waited += 1500) {
      const now = await readAs(name)
      if (!now.running && now.next === null && waited > 4000) break
      await sleep(1500)
    }
    await sleep(1500)
    return readAs(name)
  }
  const pipEnd = await drive.capture('Pip, settled', () => settle('Pip').then((value) => JSON.stringify(value)))
  const gemEnd = await drive.capture('Gem, settled', async () => {
    await open('Gem')
    return JSON.stringify(await settle('Gem'))
  })
  const pip = JSON.parse(String(pipEnd))
  const gem = JSON.parse(String(gemEnd))
  say(`Pip said: ${JSON.stringify(pip.said)}`)
  say(`Gem said: ${JSON.stringify(gem.said)}`)
  check("Pip was sent Pip's queued line, once", count(pip.said, 'PIP_QUEUED') === 1, String(count(pip.said, 'PIP_QUEUED')))
  check('Pip was sent nothing meant for Gem', count(pip.said, 'GEM_') === 0, JSON.stringify(pip.said))
  check("Gem was sent Gem's edited line, once", count(gem.said, 'GEM_EDITED') === 1, String(count(gem.said, 'GEM_EDITED')))
  check('Gem was sent nothing meant for Pip, and not the line before the edit', count(gem.said, 'PIP_') === 0 && count(gem.said, 'GEM_QUEUED') === 0, JSON.stringify(gem.said))
  const file = (name) => {
    const path = join(workspace, 'notes', `${name}.txt`)
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
  }
  say(`files: pip-queued ${JSON.stringify(file('pip-queued'))}, gem-queued ${JSON.stringify(file('gem-queued'))}`)
  check("Pip's queued line ran as Pip's turn: its file says PIP_QUEUED", (file('pip-queued') ?? '').includes('PIP_QUEUED'))
  check("Gem's edited line ran as Gem's turn: its file says GEM_EDITED", (file('gem-queued') ?? '').includes('GEM_EDITED'))

  // A stopped run keeps its queued line to itself.
  await open('Pip')
  await drive.capture('Pip starts another long run', () => drive.evaluate(type(LONG('pip-third'))))
  check("Pip's third run is under way", await untilRunning())
  await drive.evaluate(type(QUEUED('PIP_HELD', 'pip-held')))
  await sleep(800)
  const stopped = JSON.parse(String(await drive.capture("Pip's run stopped with a line queued", async () => {
    await drive.evaluate(`(() => { document.querySelector('button[aria-label^="Stop the running"]')?.click() })()`)
    for (let waited = 0; waited < 30_000; waited += 500) {
      if (!(await state()).running) break
      await sleep(500)
    }
    await sleep(1000)
    return drive.evaluate(STATE)
  })))
  check("Pip's line is held in Pip's conversation, saying why", (stopped.next ?? '').includes('PIP_HELD') && /stopped/.test(stopped.note ?? ''), `${JSON.stringify(stopped.next)} ${JSON.stringify(stopped.note)}`)
  const gemWhileHeld = JSON.parse(String(await drive.capture("Gem's conversation while Pip's line is held", async () => {
    await open('Gem')
    return drive.evaluate(STATE)
  })))
  check("Gem's box does not show Pip's held line", !(gemWhileHeld.next ?? '').includes('PIP_HELD'), JSON.stringify(gemWhileHeld.next))
  say(failures === 0 ? '\nQUEUE PER CONVERSATION PASSED' : `\nQUEUE PER CONVERSATION: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Two teammates running at once, a line queued for each and one edited, then each conversation opened until both finished; last, a stopped run with a line queued. Free model; nothing was spent.' })
}
