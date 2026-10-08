// Claude Code's own slash commands in the / menu (0.426).
//
//   node _tools/drive-claude-commands.mjs [--packaged <exe>] [--tag <name>] [--model <id>]
//
// Spends: a Claude Code teammate (Haiku by default), three short turns. Run
// with LOCUST_SPEND=1.
//
// Colin, 2026-09-28: "Lots of the nerdier coders live by their commands and
// if they can't access them or see them in the same way they can in claude
// code/codex etc. it may be a turn off for them."
//
// Ada is asked to remember a word. The / menu must then list Claude Code's
// commands under its name; /compact is picked from it with Enter, which
// writes it into the box, and a second Enter sends it -- to Claude Code as the
// command, so the conversation is summarized. Asked for the word afterwards,
// Ada still has it.
//
// PRIVACY. The menu lists the person's own commands and skills too, and those
// names must not land in the record. The menu is pictured only while every
// row showing is one of Locust's or a known built-in; the whole list is read
// as counts and yes/no answers, never as names. /context is NOT driven: it
// prints memory-file paths and every connector's tools.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const model = arg('--model') ?? 'haiku'
const OUT = join(recordRoot('claude-commands-2026-09-28'), `claude-commands-${tag}`)
await mkdir(OUT, { recursive: true })

/** Names that are safe to picture: Locust's own, and Claude Code's built-ins. */
const SAFE = new Set([
  'ask', 'plan', 'edit', 'approve', 'model', 'swarm', 'stop', 'auto',
  'compact', 'context', 'clear', 'init', 'security-review', 'doctor', 'usage', 'rename', 'insights',
  'batch', 'simplify', 'debug', 'loop', 'schedule', 'cost', 'status', 'review', 'help'
])
/** Claude Code commands that would change the person's own setup: never offered. */
const HIDDEN = ['config', 'mcp', 'login', 'logout', 'permissions', 'hooks', 'output-style', 'agents', 'effort', 'fast']

const drive = await startDrive({
  name: `claude-commands-${tag}`, port: 9763, workspace: await scratchRepository('locust-drive-claude-cmds-ws-'), outPath: OUT, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'claude', model, mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const type = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  return 'typed'
})()`
const press = (key) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 500))
  return document.querySelector('form.command-dock textarea').value
})()`
/** A row's command name: the name span's text less its hint, less the slash. */
const NAME_OF = `(row) => {
  const whole = row.querySelector('.lc-slash__name')?.textContent ?? ''
  const hint = row.querySelector('.lc-slash__hint')?.textContent ?? ''
  return whole.slice(0, whole.length - hint.length).trim().replace(/^\\//, '')
}`
/** The menu as it stands: names only when every one is safe to keep. */
const menu = `(() => {
  const rows = [...document.querySelectorAll('.lc-slash .lc-slash__item')]
  const names = rows.map(${NAME_OF})
  const groups = [...document.querySelectorAll('.lc-slash .lc-slash__group')].map((g) => g.textContent.trim())
  const safe = names.every((name) => ${JSON.stringify([...SAFE])}.includes(name))
  const compact = rows.find((row) => /^\\/compact\\b/.test(row.querySelector('.lc-slash__name')?.textContent ?? ''))
  return JSON.stringify({
    open: document.querySelector('.lc-slash') !== null,
    count: rows.length,
    safe,
    names: safe ? names : undefined,
    groups,
    compactHint: compact?.querySelector('.lc-slash__hint')?.textContent.trim() ?? null,
    compactDetail: compact?.querySelector('.lc-slash__detail')?.textContent.trim() ?? null
  })
})()`
const sendAndWait = `(async () => {
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); break }
  }
  return 'sent'
})()`
const waitForEnd = `(async () => {
  for (let i = 0; i < 600; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
  }
  return 'timed out'
})()`
const threadTail = (n) => `document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-${n}) ?? ''`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Ada'))
  await sleep(800)

  // Before any run, Claude Code's own commands are already listed (since 0.694, read from its handshake; this drive
  // predates that and expected none -- drive-claude-commands-before-a-turn checks the list itself).
  const before = JSON.parse(String(await drive.capture('A bare slash before Claude Code has run', async () => {
    await drive.evaluate(type('/'))
    return drive.evaluate(menu)
  })))
  say(`  before: ${JSON.stringify(before)}`)
  check("before a run, the menu already offers Claude Code's own commands", before.open && before.groups.includes('Claude Code') && before.count > 0, JSON.stringify(before))
  await drive.evaluate(press('Escape'))

  await drive.evaluate(type('Remember this word for later: PELICAN. Reply only OK.'))
  await drive.evaluate(sendAndWait)
  const first = String(await drive.evaluate(waitForEnd))
  await sleep(2500)
  await drive.capture('The first turn', () => drive.evaluate(threadTail(300)))
  check('the first turn ended', first === 'ended', first)

  // The whole list, read as counts and yes/no only.
  await drive.evaluate(type('/'))
  const whole = JSON.parse(String(await drive.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.lc-slash .lc-slash__item')]
    const names = rows.map(${NAME_OF})
    const groups = [...document.querySelectorAll('.lc-slash .lc-slash__group')].map((g) => g.textContent.trim())
    return JSON.stringify({
      rows: rows.length,
      groups,
      has: Object.fromEntries(['compact', 'init', 'security-review', 'clear'].map((name) => [name, names.includes(name)])),
      hiddenShown: ${JSON.stringify(HIDDEN)}.filter((name) => names.includes(name)),
      modelRows: names.filter((name) => name === 'model').length
    })
  })()`)))
  await drive.evaluate(press('Escape'))
  say(`  the whole list: ${JSON.stringify(whole)}`)
  check("after a run, Claude Code's commands are listed under its name", whole.groups.includes('Claude Code') && whole.has.compact && whole.has.init && whole.has['security-review'], JSON.stringify(whole))
  check('none that would change the person\'s Claude Code setup, and /model is still Locust\'s one', whole.hiddenShown.length === 0 && whole.modelRows === 1, JSON.stringify(whole))

  const narrowed = JSON.parse(String(await drive.evaluate(`(async () => { await ${type('/comp')}; return ${menu} })()`)))
  say(`  /comp: ${JSON.stringify(narrowed)}`)
  if (narrowed.safe) {
    await drive.capture('Typing /comp', () => drive.evaluate(menu))
  } else {
    say('  (the /comp menu shows a name that is not a known built-in; not pictured)')
  }
  check('/comp narrows to /compact, with what it takes and what it does', narrowed.compactHint !== null && narrowed.compactHint.length > 0 && (narrowed.compactDetail ?? '').length > 10, JSON.stringify(narrowed))

  let boxed
  if (narrowed.compactHint !== null) {
    boxed = String(await drive.evaluate(press('Enter')))
  } else {
    // The control has no such row: type the command whole, as a person would.
    await drive.evaluate(type('/compact '))
    boxed = String(await drive.evaluate(`document.querySelector('form.command-dock textarea').value`))
  }
  const afterPick = JSON.parse(String(await drive.capture('Enter on /compact', () => drive.evaluate(menu))))
  check('Enter writes "/compact " into the box and closes the menu', boxed === '/compact ' && !afterPick.open, JSON.stringify({ boxed, afterPick }))

  const sentValue = String(await drive.evaluate(press('Enter')))
  const second = String(await drive.evaluate(waitForEnd))
  await sleep(2500)
  const compacted = String(await drive.capture('/compact sent', () => drive.evaluate(threadTail(600))))
  check('a second Enter sends it', sentValue === '' && second === 'ended', JSON.stringify({ sentValue, second }))
  check('Claude Code ran it as its command: the conversation was summarized', compacted.includes('Claude Code summarized the conversation so far, as asked'), compacted.slice(-300))

  await drive.evaluate(type('What word did I ask you to remember? Reply with just the word.'))
  await drive.evaluate(sendAndWait)
  const third = String(await drive.evaluate(waitForEnd))
  await sleep(2500)
  const answer = String(await drive.capture('Asked for the word after /compact', () => drive.evaluate(threadTail(200))))
  check('the next turn ended, and Ada still has the word', third === 'ended' && /PELICAN/i.test(answer.slice(-80)), answer.slice(-120))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on Claude Code / ${model}, Ask; teammate memory off. The menu is pictured only when every row is Locust's or a known built-in.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
