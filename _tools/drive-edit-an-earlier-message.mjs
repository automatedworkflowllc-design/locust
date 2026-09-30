// Edit an earlier message, and the conversation starts again from there (0.498).
//
//   node _tools/drive-edit-an-earlier-message.mjs [--packaged <exe>] [--tag <name>]
//
// Sol's 0.491 pass looked for an Edit on an earlier message and found none;
// Claude Code (Esc Esc), Codex and claude.ai all have one. Ash, on a free
// OpenCode model, is asked to remember FALCON, then CEDAR, then to list the
// words. The CEDAR message is edited to MAPLE and sent; asked again, the list
// must hold FALCON and MAPLE and never CEDAR -- the turns after the edited one
// were set aside, and the model was given only what came before it. Then the
// window is reloaded: the conversation reopens as the new branch, one row in
// the sidebar. Last, the FIRST message is edited: a new conversation, the old
// one still listed. Spends nothing.

import { join } from 'node:path'
import { FREE_ROUTE, conversationRows, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-edit-earlier-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `edit-an-earlier-message-${tag}`,
  port: 9799,
  workspace,
  outPath: join(recordRoot('edit-an-earlier-message-2026-09-30'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 220)}`}`)
}

const state = `JSON.stringify({
  bubbles: [...document.querySelectorAll('.lc-thread .lc-bubble')].map((el) => el.innerText.trim()),
  replies: [...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((el) => el.innerText.trim()),
  notes: [...document.querySelectorAll('.lc-thread .lc-thread__note')].map((el) => el.innerText.trim()),
  box: document.querySelector('form.command-dock textarea')?.value ?? null,
  banner: document.querySelector('.lc-queued.is-editing')?.innerText.trim() ?? null,
  rows: ${conversationRows()}.map((row) => row.title),
  edits: document.querySelectorAll('.lc-thread .lc-bubble__edit').length
})`
const read = async (title) => JSON.parse(String(await drive.capture(title, () => drive.evaluate(state))))
const send = async (text) => String(await drive.evaluate(sendAndWaitScript(text)))
// Press Edit on the message whose words contain `words`.
const editOn = (words) => `(async () => {
  const bubble = [...document.querySelectorAll('.lc-thread .lc-bubble')].find((el) => el.innerText.includes(${JSON.stringify(words)}))
  const edit = bubble?.querySelector('.lc-bubble__edit')
  if (!edit) return 'no edit on it'
  edit.click()
  await new Promise((r) => setTimeout(r, 600))
  return 'pressed'
})()`
const retype = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return 'typed'
})()`

// Send what is in the box as it stands: the edited words.
const sendTheBox = `(async () => {
  for (let i = 0; i < 40; i += 1) {
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (button && !button.disabled) { button.click(); break }
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 1500))
  for (let i = 0; i < 600; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (!document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 800))
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await send('Remember the word FALCON for later. Reply with just OK.')
  await send('Remember the word CEDAR too. Reply with just OK.')
  await send('Which words did I ask you to remember? Reply with just the words, comma separated.')
  const before = await read('three turns: FALCON, CEDAR, and the list')
  check('the list before the edit names both words', /FALCON/i.test(before.replies.at(-1) ?? '') && /CEDAR/i.test(before.replies.at(-1) ?? ''), before.replies.at(-1))
  check('every message the person typed offers Edit', before.edits === 3, before.edits)

  // What a pointer over a message shows, drawn for every message at once.
  await drive.evaluate(`(() => { const style = document.createElement('style'); style.id = 'show-edits'; style.textContent = '.lc-bubble__edit{opacity:1 !important}'; document.head.append(style) })()`)
  await drive.capture('the Edit beside each message (as on hover)', () => drive.evaluate(state))
  await drive.evaluate(`document.getElementById('show-edits')?.remove()`)
  check('Edit on the CEDAR message', String(await drive.evaluate(editOn('CEDAR'))) === 'pressed')
  const editing = await read('Edit pressed: its words in the box')
  check('its words are back in the box', /CEDAR too/.test(editing.box ?? ''), editing.box)
  check('and the box says what sending will do', /Editing an earlier message/.test(editing.banner ?? ''), editing.banner)

  await drive.evaluate(retype('Remember the word MAPLE too. Reply with just OK.'))
  await drive.evaluate(sendTheBox)
  const branched = await read('the edited message sent')
  check('the thread is the turn before it, then the edited message', JSON.stringify(branched.bubbles) === JSON.stringify(['Remember the word FALCON for later. Reply with just OK.', 'Remember the word MAPLE too. Reply with just OK.']), JSON.stringify(branched.bubbles))
  check('and says it started again', branched.notes.some((note) => /Started again from an edited message/.test(note)), JSON.stringify(branched.notes))
  check('the banner is gone once it went', branched.banner === null)

  await send('Which words did I ask you to remember? Reply with just the words, comma separated.')
  const after = await read('asked for the list again')
  const list = after.replies.at(-1) ?? ''
  check('the list now names FALCON and MAPLE', /FALCON/i.test(list) && /MAPLE/i.test(list), list)
  check('and never CEDAR: the turns after the edit were set aside', !/CEDAR/i.test(list), list)
  check('one conversation in the sidebar', after.rows.length === 1, JSON.stringify(after.rows))

  await drive.evaluate('location.reload()').catch(() => undefined)
  await sleep(4000)
  await drive.evaluate(openTeammateScript('Ash'))
  await sleep(1500)
  const reopened = await read('reloaded and reopened')
  check('reopened, the conversation is the new branch', reopened.bubbles.some((b) => /MAPLE/.test(b)) && !reopened.bubbles.some((b) => /CEDAR/.test(b)), JSON.stringify(reopened.bubbles))
  check('still one conversation in the sidebar', reopened.rows.length === 1, JSON.stringify(reopened.rows))

  check('Edit on the first message', String(await drive.evaluate(editOn('FALCON'))) === 'pressed')
  await drive.evaluate(retype('Remember the word OTTER. Reply with just OK.'))
  await drive.evaluate(sendTheBox)
  const fresh = await read('the first message edited and sent')
  check('editing the first message starts a new conversation with only it', fresh.bubbles.length === 1 && /OTTER/.test(fresh.bubbles[0] ?? ''), JSON.stringify(fresh.bubbles))
  check('and the old one is still in the sidebar', fresh.rows.length === 2, JSON.stringify(fresh.rows))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
