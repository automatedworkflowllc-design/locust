// About you: the person's standing note, read by every teammate (0.423).
//
//   node _tools/drive-about-you.mjs [--packaged <exe>] [--tag <name>]
//
// With teammate memory OFF -- the note is the person's words and is given
// anyway -- the note is written on the Memory screen: "End every reply with
// the word CRUMB." Ada (a free model) is asked to say hello; her reply must
// end with CRUMB. The note is removed, a new conversation begun, and the
// same question must come back without it. Free model; nothing spent.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const model = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('about-you-2026-09-28'), `about-you-${tag}`)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: `about-you-${tag}`, port: 9759, workspace: await scratchRepository('locust-drive-about-you-ws-'), outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model, mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const note = (text) => drive.evaluate(`(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  const box = document.querySelector('textarea[aria-label="About you"]')
  if (!box) return JSON.stringify({ card: false })
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  const button = [...box.closest('section').querySelectorAll('button.lc-primarybutton')].pop()
  const said = button?.innerText ?? ''
  button?.click()
  await new Promise((r) => setTimeout(r, 900))
  return JSON.stringify({ card: true, button: said, status: box.closest('section').querySelector('[role=status]')?.innerText ?? '' })
})()`)
const ask = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); break }
  }
  for (let i = 0; i < 600; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 1500))
  // CHANGELOG 0.34.0: "The fold's one line is now a trace." The clock, steps and tool counts
  // follow the answer; they are not words the teammate wrote. Test the answer's ending, not the footer.
  return JSON.stringify({
    thread: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-2000) ?? '',
    reply: [...document.querySelectorAll('.lc-thread .lc-agentline__body')].at(-1)?.innerText.trim() ?? ''
  })
})()`)
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  const wrote = JSON.parse(String(await drive.capture('Memory: About you, written', () => note('End every reply with the word CRUMB, on its own line.'))))
  check('the Memory screen has an About you card, and saving says so', wrote.card && /^Save$/.test(wrote.button) && /Saved/.test(wrote.status), JSON.stringify(wrote))

  await drive.evaluate(openTeammateScript('Ada'))
  const first = JSON.parse(String(await drive.capture('Ada, with the note', () => ask('Say hello in one short sentence.'))))
  check('with memory off, Ada is still given the note: her reply ends with CRUMB', /CRUMB\W*$/.test(first.reply), first.reply.slice(-120))

  const removed = JSON.parse(String(await drive.capture('Memory: About you, removed', () => note(''))))
  check('emptying it offers Remove, and says teammates no longer get it', removed.button === 'Remove' && /Removed/.test(removed.status), JSON.stringify(removed))

  // A new conversation, so nothing of the first is in its history: from
  // Home, where the message box starts one with the only teammate.
  await drive.evaluate(`(async () => { document.querySelector('.lc-brand__lockup')?.click(); await new Promise((r) => setTimeout(r, 900)) })()`)
  const second = JSON.parse(String(await drive.capture('Ada, after the note is removed', () => ask('Say hello in one short sentence.'))))
  const asked = (second.thread.match(/Say hello in one short sentence/g) ?? []).length
  check('with the note removed, a new conversation has no CRUMB', asked === 1 && second.reply.length > 0 && !/CRUMB/.test(second.thread), `${String(asked)} question(s) in view || ${second.reply.slice(-120)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on ${model}, Ask; teammate memory off.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
