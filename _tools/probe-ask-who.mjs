// Can a person make a room without knowing rooms exist?
//
//   node _tools/probe-ask-who.mjs
//
// Colin, 2026-09-09: "how does one create a room for teammates, i cant figure
// it out lol." The design agent's answer, 2026-09-10: a room is the
// consequence of the ask, not its prerequisite. Ticking a second teammate in
// the home composer fans the post out and MAKES the room.
//
// Nothing is sent to a model here: the probe ticks names and reads what the
// box says it will do. The send itself is the spending half and is checked
// separately.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-askwho-ws-')
const drive = await startDrive({
  name: 'ask-who',
  port: 9462,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-05T05:01:00.000Z' },
      { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-05T05:02:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const readBox = `(() => {
  const chips = [...document.querySelectorAll('.lc-askwho__pick')]
  const send = [...document.querySelectorAll('button')].find(b => /Start mission|Ask all/i.test(b.getAttribute('aria-label') ?? ''))
  return JSON.stringify({
    chips: chips.map(c => c.innerText.replace(/\\s+/g, ' ').trim() + (c.getAttribute('aria-checked') === 'true' ? ' [on]' : '')),
    placeholder: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'none',
    send: send?.innerText.replace(/\\s+/g, ' ').trim() || send?.getAttribute('aria-label') || 'none',
    says: document.querySelector('.lc-askwho__says')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'nothing'
  }, null, 1)
})()`

try {
  await drive.capture('the home composer, before anyone is ticked', async () => {
    await drive.ready()
    return drive.evaluate(readBox)
  })

  // The premise, OUTSIDE capture(): a picker that never rendered would make
  // every reading below a statement about an absent control.
  const chips = Number(await drive.evaluate(`document.querySelectorAll('.lc-askwho__pick').length`))
  if (chips < 3) throw new Error(`NO PICKER: the composer shows ${String(chips)} teammate chips`)
  say(`  ${String(chips)} teammates offered in the box`)

  await drive.capture('tick a second teammate', () => drive.evaluate(`(async () => {
    const atlas = [...document.querySelectorAll('.lc-askwho__pick')].find(c => /Atlas/.test(c.innerText))
    if (!atlas) return 'no Atlas chip'
    atlas.click()
    await new Promise(r => setTimeout(r, 400))
    return ${readBox}
  })()`))

  await drive.capture('and a third, and then everyone', () => drive.evaluate(`(async () => {
    const juno = [...document.querySelectorAll('.lc-askwho__pick')].find(c => /Juno/.test(c.innerText))
    if (juno) juno.click()
    await new Promise(r => setTimeout(r, 400))
    const three = ${readBox}
    const everyone = document.querySelector('.lc-askwho__all')
    if (everyone) everyone.click()
    await new Promise(r => setTimeout(r, 400))
    return JSON.stringify({ three: JSON.parse(three), afterEveryone: JSON.parse(${readBox}) }, null, 1)
  })()`))

  await drive.capture('untick back to one and the box is the app it always was', () => drive.evaluate(`(async () => {
    for (const chip of [...document.querySelectorAll('.lc-askwho__pick')]) {
      if (chip.getAttribute('aria-checked') === 'true' && !/Wren/.test(chip.innerText)) {
        chip.click()
        await new Promise(r => setTimeout(r, 250))
      }
    }
    return ${readBox}
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates, nothing run and nothing sent -- the probe ticks names and reads what the box promises.' })
}
