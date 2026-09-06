// Auto mode, the one a person switches on for themselves.
//
//   node _tools/drive-auto.mjs
//
// Colin, 2026-09-06: "there needs to be an 'auto' option if possible for some
// models to allow them to work out of the workspace folder if desired by the
// user". The claim this drive has to settle is not that a flag is in the argv
// -- the unit tests own that -- but that a person can turn it on, pick it, and
// have a run write a file OUTSIDE the workspace folder, which every other mode
// refuses. So the proof is a file on disk in a directory the mission was never
// given, and the control is the same prompt with the switch off.
//
// Spends two short runs on Claude Code / sonnet: the one runtime measured to
// take a "write here" instruction literally in both directions.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-auto-ws-')
// A directory the mission is never told about and never given: the only way a
// file lands here is a run that was not confined to its folder.
const outside = await mkdtemp(join(tmpdir(), 'locust-drive-auto-outside-'))
await writeFile(join(outside, 'NOTE.md'), 'This directory is outside the mission workspace.\n', 'utf8')
const target = join(outside, 'auto-proof.txt').replace(/\\/g, '/')

const drive = await startDrive({
  name: 'auto',
  port: 9304,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      // The Auto run goes to a teammate with no history. Sending it to Wren
      // instead continued Wren's conversation, so Claude Code resumed the
      // session whose earlier turn had concluded it was confined and answered
      // from that memory -- "re-attempting won't change that outcome" -- while
      // the mode, the sandbox and the record were all correct. A fresh
      // teammate is a first turn, which is also the ordinary case.
      { teammateId: 'tm_vale', name: 'Vale', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }
    ],
    missionOwners: {},
    // Auto starts OFF, which is the state every person's first launch is in.
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const readTarget = async () => {
  try {
    return (await readFile(target, 'utf8')).trim().slice(0, 40)
  } catch {
    return undefined
  }
}

const modeMenuScript = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => /Ask|Accept edits|Plan|Approve|Auto/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click()
  await new Promise(r => setTimeout(r, 400))
  const items = [...document.querySelectorAll('[role=menuitemradio]')].map(b => b.innerText.replace(/[ \\t\\n]+/g, ' ').trim())
  control.click()
  await new Promise(r => setTimeout(r, 200))
  return 'modes offered: ' + items.join(' || ')
})()`

try {
  await drive.capture('launch, and the mode menu with Auto switched off', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren').click(); await new Promise(r => setTimeout(r, 500)) })()`)
    const route = await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
    return route + ' || ' + (await drive.evaluate(modeMenuScript))
  })

  await drive.capture('the control run: Accept edits, asked to write outside the folder', async () => {
    await drive.evaluate(`(async () => {
      const control = [...document.querySelectorAll('.lc-control')].find(b => /Ask|Accept edits|Plan|Approve/.test(b.innerText))
      control.click(); await new Promise(r => setTimeout(r, 300))
      ;[...document.querySelectorAll('[role=menuitemradio]')].find(b => /^Accept edits/.test(b.innerText.trim()))?.click()
      await new Promise(r => setTimeout(r, 300))
    })()`)
    await drive.evaluate(sendAndWaitScript(`Create a file at ${target} whose only contents are the word READY. Then reply with one sentence saying whether you managed it.`, { waitSeconds: 240 }))
    const wrote = await readTarget()
    return `file outside the workspace: ${wrote === undefined ? 'ABSENT (the folder held)' : `PRESENT "${wrote}"`} || ` +
      (await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(-220) ?? '')`))
  })

  await drive.capture('Settings: the Auto mode section, switched on', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /Auto mode/.test(h.textContent))
    if (!heading) return 'no Auto mode section'
    heading.scrollIntoView({ block: 'start' })
    await new Promise(r => setTimeout(r, 300))
    const section = heading.closest('.lc-settings__section')
    const before = section.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 200)
    const toggle = section.querySelector('button[role=switch]')
    toggle.click()
    await new Promise(r => setTimeout(r, 700))
    return 'before: ' + before + ' || after: ' + section.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 200)
  })()`))

  await drive.capture('Vale, who has no history: Auto is offered now, and picked', async () => {
    await drive.evaluate(`(async () => {
      document.querySelector('button[title="All missions (Ctrl 1)"]')?.click()
      await new Promise(r => setTimeout(r, 500))
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Vale').click()
      await new Promise(r => setTimeout(r, 900))
    })()`)
    await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
    const offered = await drive.evaluate(modeMenuScript)
    const picked = await drive.evaluate(`(async () => {
      const control = [...document.querySelectorAll('.lc-control')].find(b => /Ask|Accept edits|Plan|Approve|Auto/.test(b.innerText))
      control.click(); await new Promise(r => setTimeout(r, 400))
      const auto = [...document.querySelectorAll('[role=menuitemradio]')].find(b => /^Auto\\b/.test(b.innerText.trim()))
      if (!auto) return 'Auto not in the menu'
      const consequence = auto.querySelector('.lc-menu__desc')
      const amber = consequence ? getComputedStyle(consequence).color : 'no consequence line'
      auto.click()
      await new Promise(r => setTimeout(r, 400))
      return 'picked: ' + control.innerText.replace(/[ \\t\\n]+/g, ' ').trim() + ' || consequence colour: ' + amber
    })()`)
    return offered + ' || ' + picked
  })

  await drive.capture('the Auto run: the same instruction, and the file on disk', async () => {
    await drive.evaluate(sendAndWaitScript(`Create a file at ${target} whose only contents are the word READY. Then reply with one sentence saying whether you managed it.`, { waitSeconds: 300 }))
    const wrote = await readTarget()
    return `file outside the workspace: ${wrote === undefined ? 'ABSENT' : `PRESENT "${wrote}"`} || ` +
      (await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(-260) ?? '')`))
  })

  await drive.capture('the header records what the run was allowed', () => drive.evaluate(`(document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 200) ?? '')`))

  await drive.capture('switched off again: Auto leaves the menu and the composer moves off it', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /Auto mode/.test(h.textContent))
    heading.closest('.lc-settings__section').querySelector('button[role=switch]').click()
    await new Promise(r => setTimeout(r, 700))
    // Back to the CONVERSATION, not the missions list: the list has no
    // composer, so the mode control is simply absent there and the step
    // reported an error object instead of an answer (2026-09-06).
    const row = [...document.querySelectorAll('.lc-teammate')].find(r => /Vale/.test(r.innerText))
    row?.querySelector('.lc-teammate__mission')?.click()
    await new Promise(r => setTimeout(r, 900))
    const control = [...document.querySelectorAll('.lc-control')].find(b => /Ask|Accept edits|Plan|Approve|Auto/.test(b.innerText))
    if (!control) return 'no mode control on screen'
    const shown = control.innerText.replace(/[ \\t\\n]+/g, ' ').trim()
    control.click(); await new Promise(r => setTimeout(r, 400))
    const items = [...document.querySelectorAll('[role=menuitemradio]')].map(b => b.innerText.replace(/[ \\t\\n]+/g, ' ').trim().split(' ')[0])
    control.click()
    return 'composer now shows: ' + shown + ' || modes offered: ' + items.join(', ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: whatever \`pnpm build\` last wrote to out/. Wren runs the control on Claude Code / sonnet and Vale runs the Auto one, so the two never share a runtime session. The workspace is ${workspace.replace(/\\/g, '/')}; the file the runs are asked for is ${target}, in a directory the mission was never given.`
  })
  await rm(outside, { recursive: true, force: true })
}
