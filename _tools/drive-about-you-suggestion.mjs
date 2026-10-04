// A teammate suggests a line for About you; the person decides (0.424).
//
//   node _tools/drive-about-you-suggestion.mjs [--packaged <exe>] [--tag <name>] [--runtime <id> --model <id> [--spend]]
//
// Teammate memory OFF, and a note already saved: "Keep answers short." Ada is
// told how the person likes numbers and asked to suggest it for the note. The
// line must wait under "Waiting for you" -- not be added -- and Add must put it
// at the end of the note. A free model unless --runtime/--model say otherwise.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const runtime = arg('--runtime') ?? 'opencode'
const model = arg('--model') ?? process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const spends = process.argv.includes('--spend')
const OUT = join(recordRoot('about-you-suggestion-2026-09-28'), `about-you-suggestion-${runtime}-${tag}`)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: `about-you-suggestion-${tag}`, port: 9761, workspace: await scratchRepository('locust-drive-about-you-sugg-ws-'), outPath: OUT,
  ...(spends ? { spends: true } : {}),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime, model, mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, aboutYou: 'Keep answers short.' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
// The row arrives when the run's end has been read, which is a moment after
// the run stops: wait for it, up to half a minute, as a person would glance back.
const memoryScreen = `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
  for (let i = 0; i < 60 && document.querySelectorAll('.lc-memory.is-proposed').length === 0; i += 1) await new Promise((r) => setTimeout(r, 500))
  await new Promise((r) => setTimeout(r, 500))
  return JSON.stringify({
    note: document.querySelector('textarea[aria-label="About you"]')?.value ?? '(no card)',
    waiting: [...document.querySelectorAll('.lc-memory.is-proposed')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()),
    header: document.querySelector('.lc-screen__meta')?.innerText ?? ''
  })
})()`
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Ada'))
  const ran = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Something lasting about me: whenever you give me numbers, I want them in a table. Suggest that as one sentence for my About-you note, using the block your instructions show for it, then reply OK.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
    }
    return 'timed out'
  })()`))
  await sleep(2500)
  await drive.capture('Ada’s reply', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-400) ?? ''`))
  const before = JSON.parse(String(await drive.capture('Memory: the suggestion, waiting', () => drive.evaluate(memoryScreen))))
  say(`  memory screen: ${JSON.stringify(before)}`)
  check('the run ended', ran === 'ended', ran)
  check('with memory off, the suggestion waits for the person, from Ada', before.waiting.length === 1 && /Suggested for About you:.*table/i.test(before.waiting[0] ?? '') && /Ada/.test(before.waiting[0] ?? ''), JSON.stringify(before.waiting))
  check('and the note is not changed until the person says', before.note === 'Keep answers short.', JSON.stringify(before.note))
  check('the header counts it as waiting', /1 waiting for you/.test(before.header), before.header)

  const after = JSON.parse(String(await drive.capture('Add to About you', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-memory.is-proposed button')].find((b) => b.innerText.trim() === 'Add to About you')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return ${memoryScreen}
  })()`))))
  say(`  after Add: ${JSON.stringify(after)}`)
  check('Add puts the line at the end of the note, and it stops waiting', /^Keep answers short\.\n.*table/is.test(after.note) && after.waiting.length === 0, JSON.stringify(after))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on ${runtime} / ${model}, Ask; teammate memory off; About you = "Keep answers short."`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
