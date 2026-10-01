// What the 0.504 Sol brief asked that no other drive checks (0.508).
//
//   node _tools/drive-sol-brief-gaps.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30: "just run it yourself like you literally coded the app".
// The other drives cover most of docs/BETA-BRIEF-2026-09-30-0503-sol.md; this
// one covers the rest:
//   - an edit cancelled halfway: the box and banner clear, nothing is sent;
//   - an edit sent WITHOUT "Also put back": the files stay as they are;
//   - Cloud on a model that is not Codex: the menu says why it cannot be picked;
//   - Finances, shelved in 0.510, is gone from Settings and the sidebar;
//   - Settings > Runtimes: how Codex's row reads (recorded for a person to read).
// Ash is on the free OpenCode model. Spends nothing.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-sol-gaps-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `sol-brief-gaps-${tag}`,
  port: 9815,
  workspace,
  outPath: join(recordRoot('sol-brief-gaps-2026-09-30'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE },
      // Someone who had Finances on before 0.510: its teammate stays, an ordinary one.
      { teammateId: 'tm_fin', name: 'Finances', hue: 'teal', role: 'Custom', roleTitle: 'Reads the statements you put in its folder', createdAt: '2026-09-30T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', financesPlace: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}
const read = (name) => readFile(join(workspace, name), 'utf8').catch(() => undefined)
const flat = (text) => (text ?? '').replace(/\r\n/g, '\n').trim()
const thread = `JSON.stringify({
  bubbles: document.querySelectorAll('.lc-thread .lc-bubble').length,
  box: document.querySelector('form.command-dock textarea')?.value ?? null,
  banner: !!document.querySelector('.lc-queued.is-editing'),
  running: !!document.querySelector('button[aria-label^="Stop the running"]')
})`
const settingsPage = (page) => `(async () => {
  // Opened only if it is not open already: a second click on Settings closes it.
  if (!document.querySelector('.lc-settings__navitem')) {
    ;[...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')?.click()
    await new Promise((r) => setTimeout(r, 700))
  }
  ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => new RegExp(${JSON.stringify(page)}).test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 700))
})()`
const sidebarHasFinances = `!![...document.querySelectorAll('.lc-sidebar__places button')].find((b) => /Finances/.test(b.innerText))`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))

  // Cloud on a model that is not Codex.
  const cloudItem = JSON.parse(String(await drive.capture('Cloud in the menu, on the free OpenCode model', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('.lc-menu [role="menuitemradio"]')].find((el) => /^Cloud/.test(el.innerText.trim()))
    const seen = { present: !!item, disabled: item?.getAttribute('aria-disabled') ?? null, title: item?.getAttribute('title') ?? null }
    item?.click()
    await new Promise((r) => setTimeout(r, 600))
    seen.note = document.querySelector('.lc-composer .lc-notice')?.innerText.trim() ?? null
    seen.panel = !!document.querySelector('.lc-cloudtasks')
    seen.placeholder = document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? null
    return JSON.stringify(seen)
  })()`))))
  check('on a model that is not Codex, Cloud cannot be picked, and says why', cloudItem.present && cloudItem.disabled === 'true' && (cloudItem.title ?? '').length > 10 && cloudItem.panel === false, JSON.stringify(cloudItem))
  check('and picking it anyway says the reason under the box, and stays Direct', (cloudItem.note ?? '') === cloudItem.title && !/Codex Cloud/.test(cloudItem.placeholder ?? ''), JSON.stringify(cloudItem))

  await drive.evaluate(sendAndWaitScript('Create a file named notes.txt whose entire content is the single line ALPHA. Do nothing else.'))
  await drive.evaluate(sendAndWaitScript('Change notes.txt so its entire content is the single line BETA. Do nothing else.'))
  check('the replies did what was asked: notes.txt BETA', flat(await read('notes.txt')) === 'BETA', flat(await read('notes.txt')))
  const before = JSON.parse(String(await drive.evaluate(thread)))

  // An edit cancelled halfway.
  const cancelled = JSON.parse(String(await drive.capture('an edit, changed, then cancelled', () => drive.evaluate(`(async () => {
    const bubble = [...document.querySelectorAll('.lc-thread .lc-bubble')].find((el) => el.innerText.includes('BETA'))
    bubble?.querySelector('.lc-bubble__edit')?.click()
    await new Promise((r) => setTimeout(r, 700))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Change notes.txt so its entire content is the single line HALFWAY.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const mid = { banner: !!document.querySelector('.lc-queued.is-editing') }
    document.querySelector('.lc-queued.is-editing .lc-queued__action')?.click()
    await new Promise((r) => setTimeout(r, 3000))
    return JSON.stringify({ mid, after: JSON.parse(${thread}) })
  })()`))))
  check('an edit cancelled halfway: the banner was up, then the box and banner clear', cancelled.mid.banner && cancelled.after.banner === false && cancelled.after.box === '', JSON.stringify(cancelled))
  check('and nothing was sent', cancelled.after.running === false && cancelled.after.bubbles === before.bubbles && flat(await read('notes.txt')) === 'BETA', JSON.stringify({ before, after: cancelled.after }))

  // An edit sent without "Also put back".
  const unticked = JSON.parse(String(await drive.capture('an edit sent with Also put back left unticked', () => drive.evaluate(`(async () => {
    const bubble = [...document.querySelectorAll('.lc-thread .lc-bubble')].find((el) => el.innerText.includes('BETA'))
    bubble?.querySelector('.lc-bubble__edit')?.click()
    await new Promise((r) => setTimeout(r, 700))
    const offer = { label: document.querySelector('.lc-queued__check')?.innerText.trim() ?? null, ticked: document.querySelector('.lc-queued__check input')?.checked ?? null }
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with the single word DONE. Do not touch any file.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Start mission"]')?.click()
    await new Promise((r) => setTimeout(r, 2500))
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    // The reply is what comes AFTER the edited words: the words themselves say DONE too.
    const all = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
    const asked = 'Reply with the single word DONE. Do not touch any file.'
    const tail = all.slice(all.lastIndexOf(asked) + asked.length).trim()
    return JSON.stringify({ offer, notes: [...document.querySelectorAll('.lc-thread .lc-thread__note')].map((el) => el.innerText.trim()).join(' / '), tail: tail.slice(0, 200) })
  })()`))))
  check('the offer to put back was there, unticked', /put back the 1 file/.test(unticked.offer.label ?? '') && unticked.offer.ticked === false, JSON.stringify(unticked.offer))
  check('sent unticked, the file stays as the replies left it', flat(await read('notes.txt')) === 'BETA', flat(await read('notes.txt')))
  check('and the edit went: the reply came back', /\bDONE\b/.test(unticked.tail) && !/was put back/.test(unticked.notes), JSON.stringify({ notes: unticked.notes, tail: unticked.tail }))

  // Finances was shelved in 0.510: no switch in Settings, no row in the sidebar.
  await drive.evaluate(settingsPage('Connectors'))
  const finances = JSON.parse(String(await drive.capture('Settings > Connectors, after Finances was shelved', () => drive.evaluate(`JSON.stringify({
    // Every switch on the page, read by its label: looking for one that must not exist.
    switch: [...document.querySelectorAll('button[role="switch"]')].some((b) => b.getAttribute('aria-label') === 'Finances'),
    heading: [...document.querySelectorAll('.lc-settings__heading')].some((h) => /Finances/.test(h.innerText)),
    sidebar: ${sidebarHasFinances}
  })`))))
  check('Finances is gone, even for someone who had it on: no switch, no heading, no sidebar row (0.510)', !finances.switch && !finances.heading && !finances.sidebar, JSON.stringify(finances))
  const kept = JSON.parse(await readFile(join(drive.profile, 'teammates.json'), 'utf8').catch(() => '{}'))
  check('and their Finances teammate is still there, an ordinary teammate', (kept.teammates ?? []).some((t) => t.teammateId === 'tm_fin' && t.name === 'Finances'), JSON.stringify((kept.teammates ?? []).map((t) => t.name)))

  // Settings > Runtimes: Codex's row, recorded for a person to read.
  await drive.evaluate(settingsPage('Runtimes'))
  const codexRow = String(await drive.capture('Settings > Runtimes', () => drive.evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 1500))
    const page = document.querySelector('main')?.innerText ?? document.body.innerText
    const flat = page.replace(/\\s+/g, ' ')
    const at = flat.search(/\\bCodex\\b[^.]{0,40}\\d+\\.\\d+/)
    return at < 0 ? 'no Codex row found: ' + flat.slice(0, 300) : flat.slice(at, at + 260)
  })()`)))
  say(`  Codex's row in Settings > Runtimes: ${codexRow}`)
  check('Settings > Runtimes has a Codex row with a version', !codexRow.startsWith('no Codex row found') && codexRow !== 'undefined', codexRow)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
