// A routine per teammate, on different runtimes, and whether the sidebar
// shows them all.
//
//   node _tools/drive-routines-many.mjs
//
// Colin, 2026-09-06: "maybe try setting up automations/routines for each model
// and see if they show up on the left bar". The Automations section was added
// in 0.36.0 and has only ever been seen holding NOTHING -- its empty state is
// the thing that was designed and driven. Nobody has watched it hold several,
// across several runtimes, which is the state a person who actually uses the
// feature lives in.
//
// Three teammates on three different routes, a conversation each, saved as a
// routine each, then the sidebar read. Two of the three are free or cheap;
// the third is Cursor's composer-2.5, which is what the house rules say to use
// where the model does not matter.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-routines-ws-')

// Deliberately different runtimes: a routine is a saved conversation, and the
// route rides with it, so three routines on one runtime would prove nothing
// about the list.
const TEAM = [
  { name: 'Wren', word: 'ALPHA', group: /opencode/i, search: 'muse', row: /muse/i },
  { name: 'Booty', word: 'BRAVO', group: /cursor/i, search: 'composer', row: /composer-2\.5/i },
  { name: 'Gem', word: 'CHARLIE', group: /opencode/i, search: 'muse', row: /muse/i }
]

const drive = await startDrive({
  name: 'routines-many',
  port: 9322,
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

/** One conversation for a teammate, on its own route. */
const converse = async (member) => {
  await drive.evaluate(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message ${member.name}')?.click()
    await new Promise(r => setTimeout(r, 700))
  })()`)
  await drive.evaluate(pickRouteScript({ group: member.group, search: member.search, row: member.row }))
  await drive.evaluate(
    sendAndWaitScript(`Reply with exactly the word ${member.word} and nothing else.`, { waitSeconds: 300 })
  )
  return drive.evaluate(`(() => (document.querySelector('.lc-thread')?.innerText ?? '').includes('${member.word}'))()`)
}

/** Right-click that teammate's conversation and save it as a routine. */
const saveRoutine = (member) => drive.evaluate(`(async () => {
  const card = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + ${JSON.stringify(member.name)}).test(r.innerText.trim()))
  const row = card?.querySelector('.lc-teammate__mission')
  if (!row) return 'no conversation to save'
  const box = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 8) }))
  await new Promise(r => setTimeout(r, 500))
  const item = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find(b => /Save as routine/.test(b.innerText))
  if (!item) return 'no Save as routine in the menu'
  if (item.disabled) return 'Save as routine is DISABLED: ' + (item.title || 'no reason given')
  item.click()
  await new Promise(r => setTimeout(r, 600))
  const dialog = document.querySelector('[role=dialog][aria-label="Save as routine"]')
  if (!dialog) return 'the dialog did not open'
  const every = [...dialog.querySelectorAll('[role=radio]')].find(b => /Every few hours/.test(b.innerText))
  every?.click()
  await new Promise(r => setTimeout(r, 300))
  const save = [...dialog.querySelectorAll('button')].find(b => /^Save/.test(b.innerText.trim()))
  if (!save) return 'no Save button'
  save.click()
  await new Promise(r => setTimeout(r, 900))
  return 'saved for ' + ${JSON.stringify(member.name)}
})()`)

try {
  await drive.capture('three teammates, nothing automated yet', async () => {
    await drive.ready()
    return drive.evaluate(`(() => {
      const section = [...document.querySelectorAll('.lc-sidebar *')].find(n => /AUTOMATIONS/.test(n.textContent ?? '') && n.children.length < 4)
      const sidebar = document.querySelector('.lc-sidebar')?.innerText.replace(/[ ]+/g, ' ') ?? ''
      return 'Automations section: ' + (section === undefined ? 'ABSENT' : 'present')
        + ' || says: ' + (sidebar.match(/AUTOMATIONS[\\s\\S]{0,40}/)?.[0].split(String.fromCharCode(10)).join(' ') ?? 'nothing')
    })()`)
  })

  for (const member of TEAM) {
    await drive.capture(`${member.name}: a conversation on its own route`, async () => {
      const replied = await converse(member)
      return `${member.name} replied with its word: ${String(replied)}`
    })
    await drive.capture(`${member.name}: saved as a routine`, () => saveRoutine(member))
  }

  await drive.capture('THE QUESTION: does the left bar show all three', () => drive.evaluate(`(() => {
    const sidebar = document.querySelector('.lc-sidebar')?.innerText.replace(/[ ]+/g, ' ') ?? ''
    const after = sidebar.slice(sidebar.indexOf('AUTOMATIONS'))
    const rows = [...document.querySelectorAll('.lc-automation, .lc-routine, .lc-sidebar__routine')]
    return 'rows found by class: ' + rows.length
      + ' || the section reads: ' + after.split(String.fromCharCode(10)).filter(t => t.trim().length > 0).slice(0, 10).join(' / ')
  })()`))

  await drive.capture('and the Automations screen itself', () => drive.evaluate(`(async () => {
    const nav = [...document.querySelectorAll('button')].find(b => /Automations/i.test(b.innerText.trim()))
    nav?.click()
    await new Promise(r => setTimeout(r, 900))
    const body = document.querySelector('main, .lc-screen, .lc-automations')?.innerText.replace(/[ ]+/g, ' ') ?? ''
    return body.split(String.fromCharCode(10)).filter(t => t.trim().length > 0).slice(0, 14).join(' / ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates on three routes, a routine saved for each, then the sidebar and the Automations screen read.'
  })
}
