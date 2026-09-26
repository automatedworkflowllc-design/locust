// Send feedback, the folder back on the row, and Edit racing the end of a run.
//
//   node _tools/drive-feedback-and-edit.mjs [--packaged <exe>] [--tag <name>] [--model <free model>] [--send]
//
// Three asks from 2026-09-23:
// - Colin: "for bug reporting we can use what claude code does" -- the Send
//   feedback box, from a conversation's own menu and from Settings. --send
//   presses Send once, from Settings, which OPENS ONE BROWSER TAB on GitHub's
//   new-issue page, filled in; nothing is submitted.
// - Colin: "our workspace folder asset is gone ... we just can use what we
//   used to have": the folder chip on the composer row.
// - The outside recheck of 0.303: Edit takes a queued message back into the
//   box, and a run that finished mid-edit sent nothing without saying so.
//   The box now says "Off the queue".
//
// One run on a free OpenCode model (refused on anything else). Sends nothing
// else.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const MODEL = arg('--model') ?? 'lightning'
const SEND = process.argv.includes('--send')
const OUT = join(recordRoot('beta-fixes-2026-09-23'), `feedback-and-edit-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-feedback-edit-ws-')
const drive = await startDrive({
  name: `feedback-and-edit-${tag}`,
  port: 9495,
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_pip', name: 'Pip', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const type = (text, enter = true) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Mission instruction"]')
  if (!box) return 'no box'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 250))
  box.focus()
  if (${enter ? 'true' : 'false'}) box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'typed'
})()`

const STATE = `(() => JSON.stringify({
  // The header's own word: a run that is still starting shows no Stop button,
  // and reading that as finished judged the box against a run still going.
  running: document.querySelector('button[aria-label^="Stop the running"]') !== null || / · (running|starting)/i.test(document.querySelector('.lc-workroom__mission')?.textContent ?? ''),
  status: (document.querySelector('.lc-workroom__mission')?.textContent ?? '').trim(),
  queued: document.querySelector('.lc-queued:not(.is-editing) .lc-queued__text')?.textContent ?? null,
  editing: document.querySelector('.lc-queued.is-editing .lc-queued__note')?.textContent ?? null,
  box: document.querySelector('textarea[aria-label="Mission instruction"]')?.value ?? null,
  folder: document.querySelector('.lc-control--folder .lc-control__folder')?.textContent ?? null,
  said: [...document.querySelectorAll('.lc-thread .lc-bubble')].map((node) => node.textContent.trim())
}))()`
const state = async () => JSON.parse(String(await drive.evaluate(STATE)))

const TOKEN = 'EDITED_AFTER_THE_RUN'

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Pip')}?.click(); await new Promise((r) => setTimeout(r, 1200)) })()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: MODEL, row: `/${MODEL}/i` }))
  const route = String(await drive.evaluate(`(() => ([...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))?.textContent ?? '').trim())()`))
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`route is ${JSON.stringify(route)} -- refusing anything but a free OpenCode model`)
  say(`route: ${route}`)

  // The folder, back on the row.
  const before = await drive.capture('the composer, the folder back on the row', () => drive.evaluate(STATE))
  const folderName = JSON.parse(String(before)).folder
  check('the folder chip is on the composer row, naming the folder', typeof folderName === 'string' && workspace.endsWith(folderName), `${String(folderName)} (${workspace})`)

  // A run long enough to queue behind, then a line queued, then Edit.
  await drive.evaluate(type('Create the files notes/pip-01.txt through notes/pip-08.txt, one at a time, each containing only its own number. Do nothing else. Then say PIP FIRST.'))
  let running = false
  for (let waited = 0; waited < 60_000 && !running; waited += 500) {
    running = (await state()).running
    if (!running) await sleep(500)
  }
  check("Pip's run is under way", running)
  await drive.evaluate(type(`Create notes/queued.txt containing only the word ${TOKEN}. Then say ${TOKEN} DONE.`))
  await sleep(800)
  check('the line is queued', (await state()).queued?.includes(TOKEN) === true, (await state()).queued ?? 'nothing queued')
  const edited = await drive.capture('Edit: the queued line back in the box, and the box says so', async () => {
    await drive.evaluate(`(() => { [...document.querySelectorAll('.lc-queued button')].find((b) => b.textContent.trim() === 'Edit')?.click() })()`)
    await sleep(600)
    return drive.evaluate(STATE)
  })
  const mid = JSON.parse(String(edited))
  check('Edit puts the words in the box and takes them off the queue', mid.box?.includes(TOKEN) === true && mid.queued === null, `box ${JSON.stringify(mid.box)}, queued ${JSON.stringify(mid.queued)}`)
  check('and the box says they are off the queue until Enter', /^Off the queue while you edit — Enter queues it again/.test(mid.editing ?? ''), JSON.stringify(mid.editing))

  // The run finishes while the words sit in the box.
  let done = false
  for (let waited = 0; waited < 240_000 && !done; waited += 1000) {
    done = !(await state()).running
    if (!done) await sleep(1000)
  }
  check("Pip's run finished", done)
  await sleep(1500)
  const after = JSON.parse(String(await drive.capture('the run over, the edited words still in the box', () => drive.evaluate(STATE))))
  check('nothing was sent by itself', !after.said.some((line) => line.includes(TOKEN)), JSON.stringify(after.said.slice(-2)))
  check('the box still holds the words, and now says Enter sends them', after.box?.includes(TOKEN) === true && after.editing === 'Off the queue — Enter sends it', JSON.stringify(after.editing))

  // Send feedback from the conversation's own menu: it says it takes this conversation.
  const fromMenu = await drive.capture("Send feedback from the conversation's menu", () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="More actions"]')?.click()
    await new Promise((r) => setTimeout(r, 500))
    const item = [...document.querySelectorAll('[role="menuitem"], .lc-menu__item')].find((el) => (el.textContent ?? '').trim().startsWith('Send feedback'))
    item?.click()
    await new Promise((r) => setTimeout(r, 600))
    const dialog = document.querySelector('.lc-feedback')
    return JSON.stringify({
      open: dialog !== null,
      title: dialog?.querySelector('.lc-dialog__title')?.textContent ?? null,
      placeholder: dialog?.querySelector('textarea')?.getAttribute('placeholder') ?? null,
      claim: dialog?.querySelector('.lc-feedback__claim')?.textContent ?? null,
      sendDisabled: [...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Send')?.disabled ?? null
    })
  })()`))
  const box = JSON.parse(String(fromMenu))
  check('the Send feedback box opens from the menu, as Claude Code draws it', box.open && box.title === 'Send feedback' && box.placeholder === 'Describe the issue' && box.sendDisabled === true, String(fromMenu))
  check('and says it includes this conversation, and opens on GitHub', /and this conversation\. It opens on GitHub, where you send it\.$/.test(box.claim ?? ''), JSON.stringify(box.claim))
  await drive.evaluate(`(() => { [...document.querySelectorAll('.lc-feedback button')].find((b) => b.textContent.trim() === 'Cancel')?.click() })()`)
  await sleep(400)
  check('Cancel closes it', (await drive.evaluate(`document.querySelector('.lc-feedback') === null`)) === true)

  // And from Settings, where --send presses Send once: one browser tab, nothing submitted.
  const fromSettings = await drive.capture('Settings, Report a problem, Send feedback', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^General$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 900))
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send feedback')
    open?.scrollIntoView()
    open?.click()
    await new Promise((r) => setTimeout(r, 600))
    return JSON.stringify({ found: open !== undefined, claim: document.querySelector('.lc-feedback .lc-feedback__claim')?.textContent ?? null })
  })()`))
  const settingsBox = JSON.parse(String(fromSettings))
  check('Settings opens the same box, without a conversation', settingsBox.found && /^This report will include your description and your Locust and Windows versions\./.test(settingsBox.claim ?? ''), String(fromSettings))
  if (SEND) {
    const sent = await drive.capture('Send: the report opens on GitHub', () => drive.evaluate(`(async () => {
      const box = document.querySelector('.lc-feedback textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, 'Driven by drive-feedback-and-edit: checking the report opens, filled in. Not a real report.')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      ;[...document.querySelectorAll('.lc-feedback button')].find((b) => b.textContent.trim() === 'Send')?.click()
      await new Promise((r) => setTimeout(r, 2500))
      return JSON.stringify({ closed: document.querySelector('.lc-feedback') === null, refusal: document.querySelector('.lc-feedback .lc-tone-amber')?.textContent ?? null })
    })()`))
    const result = JSON.parse(String(sent))
    check('Send opened the report in the browser (the box closed with no refusal)', result.closed && result.refusal === null, String(sent))
  } else {
    await drive.evaluate(`(() => { [...document.querySelectorAll('.lc-feedback button')].find((b) => b.textContent.trim() === 'Cancel')?.click() })()`)
  }
  say(failures === 0 ? '\nFEEDBACK AND EDIT PASSED' : `\nFEEDBACK AND EDIT: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The folder on the row; Edit taking a queued line back while the run finishes; Send feedback from a conversation and from Settings. One free OpenCode run.' })
}
