// Three teammates working at the same time.
//
//   node _tools/drive-concurrent.mjs
//
// The premise of the app, and never driven: every drive so far has run one
// teammate, or two in sequence through the relay. A person with three
// teammates starts one, does not wait, and starts the next -- and the
// questions are whether each keeps its own thread, whether the sidebar shows
// all three working at once, whether each reply lands in the right
// conversation, and whether the header follows whichever one is open rather
// than whichever finished last.
//
// Each teammate is given a DIFFERENT word to say back, so a reply in the
// wrong thread is visible rather than plausible. Three short runs on the free
// OpenCode model, so the whole thing costs nothing.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const WORDS = { Wren: 'ALMANAC', Booty: 'BRAMBLE', Gem: 'CINDER' }
const workspace = await scratchRepository('locust-drive-concurrent-ws-')

const drive = await startDrive({
  name: 'concurrent',
  port: 9314,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-05T05:00:01.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', createdAt: '2026-09-05T05:00:02.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Open a teammate, put it on the free model, and send without waiting. */
const startFor = async (name) => {
  await drive.evaluate(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ${name}')).click()
    await new Promise(r => setTimeout(r, 350))
  })()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
  // Sent WITHOUT waiting: the point is three at once, not three in a row.
  return drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Write a 40-line poem about locusts into a file named ${WORDS[name]}.txt, then reply with exactly the word ${WORDS[name]} and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    await new Promise(r => setTimeout(r, 300))
    return 'sent to ${name}'
  })()`)
}

try {
  // Seeded records are validated on read and a bad one is DROPPED, not
  // reported. The first run of this drive seeded roles the store does not
  // accept ('Reviewer', 'Scout'); two teammates vanished, all three prompts
  // went to the one that survived, and the capture read like a threading
  // defect. Check the premise BEFORE measuring, and outside a capture -- a
  // step that throws is recorded and the drive carries on regardless.
  await drive.ready()
  const rostered = await drive.evaluate(`document.querySelectorAll('.lc-teammate').length`)
  if (Number(rostered) !== 3) {
    throw new Error(`roster holds ${String(rostered)} teammates, not 3 -- a seeded record did not parse`)
  }

  await drive.capture('launch: three teammates, none running', () => `roster: ${String(rostered)} teammates, none running`)

  await drive.capture('start all three without waiting for any', async () => {
    const said = []
    for (const name of Object.keys(WORDS)) said.push(await startFor(name))
    return said.join(' || ')
  })

  await drive.capture('the sidebar while they run: who is working', () => drive.evaluate(`(async () => {
    const seen = []
    let peak = 0
    let peakLine = ''
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 400))
      const rows = [...document.querySelectorAll('.lc-teammate')].map(r => r.innerText.split(String.fromCharCode(10)).slice(0, 2).join(' '))
      const line = rows.join(' | ')
      if (seen[seen.length - 1] !== line) seen.push(line)
      const working = [...document.querySelectorAll('.lc-teammate')].filter(r => !/idle/.test(r.innerText)).length
      if (working > peak) { peak = working; peakLine = line }
      // Nothing more to see once they have all settled.
      if (peak > 0 && working === 0) break
    }
    return 'peak working at once: ' + String(peak) + ' || at peak: ' + peakLine + ' || over time: ' + seen.slice(0, 5).join(' -> ')
  })()`))

  await drive.capture('wait for all three to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const rows = [...document.querySelectorAll('.lc-teammate')].map(r => r.innerText)
      if (rows.every(r => /idle|done/.test(r))) return 'all settled after ' + String(i / 2) + 's'
    }
    return 'still going'
  })()`))

  await drive.capture('each reply in its own thread, and nowhere else', () => drive.evaluate(`(async () => {
    const want = ${JSON.stringify(WORDS)}
    const found = {}
    for (const name of Object.keys(want)) {
      const row = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + name).test(r.innerText.trim()))
      row?.querySelector('.lc-teammate__mission')?.click()
      await new Promise(r => setTimeout(r, 1100))
      const thread = document.querySelector('.lc-thread')?.innerText ?? ''
      const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 40) ?? ''
      const others = Object.entries(want).filter(([who]) => who !== name).filter(([, word]) => thread.includes(word)).map(([who]) => who)
      found[name] = (thread.includes(want[name]) ? 'own word yes' : 'OWN WORD MISSING')
        + (others.length > 0 ? ' + STRAY: ' + others.join(',') : '')
        + ' · header ' + header
    }
    return Object.entries(found).map(([who, said]) => who + ': ' + said).join(' || ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates on the free OpenCode model, started without waiting, each asked for a different word.'
  })
}
