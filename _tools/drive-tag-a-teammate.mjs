// Tag a teammate from any conversation (0.438).
//
//   node _tools/drive-tag-a-teammate.mjs [--packaged <exe>] [--tag <name>]
//
// Free model (LOCUST_FREE_MODEL, Nemotron by default): spends nothing.
//
// Colin, 2026-09-28: "can we tag teammates from any conversation? i saw you
// added that in rooms but it should be doable from anywhere honestly." In
// Wren's conversation Wren first answers with a word only she was asked for.
// Then "@At" must offer Atlas under Teammates; Enter must tag him (a chip,
// the text gone from the box); sending must leave the screen on Wren, say
// "Sent to Atlas too." as a report, not a refusal, and start Atlas in a
// conversation of his own -- where, given Wren's latest answer as context,
// he can name the word.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { conversationRows, git, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const WORD = 'PELICAN'
const OUT = join(recordRoot('tag-a-teammate-2026-09-28'), `tag-a-teammate-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-tag-ws-')
await writeFile(join(workspace, 'notes.md'), '# Notes\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'notes'], workspace)

const route = { runtime: 'opencode', model: MODEL, mode: 'ask' }
const drive = await startDrive({
  name: `tag-a-teammate-${tag}`, port: 9773, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-28T01:01:00.000Z', route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
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
  for (let i = 0; i < 20 && !document.querySelector('.lc-slash[aria-label="Files"]'); i += 1) await new Promise((r) => setTimeout(r, 250))
  await new Promise((r) => setTimeout(r, 300))
  const menu = document.querySelector('.lc-slash[aria-label="Files"]')
  return JSON.stringify({
    groups: [...(menu?.querySelectorAll('.lc-slash__group') ?? [])].map((el) => el.textContent.trim()),
    rows: [...(menu?.querySelectorAll('.lc-slash__item .lc-slash__name') ?? [])].map((el) => el.textContent.trim())
  })
})()`
const press = (key) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 600))
  return JSON.stringify({
    value: field.value,
    chips: [...document.querySelectorAll('.lc-tagged__chip')].map((el) => el.textContent.trim()),
    note: document.querySelector('.lc-tagged__note')?.textContent.trim() ?? ''
  })
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await sleep(800)

  const first = String(await drive.capture('Wren answers with the word', () => drive.evaluate(sendAndWaitScript(`Reply with exactly the word ${WORD} and nothing else.`))))
  check(`Wren answers ${WORD} first`, first.includes(WORD), first.slice(-160))

  const offered = JSON.parse(String(await drive.capture('Typing @At', () => drive.evaluate(type('@At')))))
  say(`  @At: ${JSON.stringify(offered)}`)
  check('@At offers Atlas under Teammates, and never Wren, who is on screen', offered.groups[0] === 'Teammates' && offered.rows[0] === '@Atlas' && !offered.rows.includes('@Wren'), JSON.stringify(offered))

  const picked = JSON.parse(String(await drive.capture('Enter tags Atlas', () => drive.evaluate(press('Enter')))))
  say(`  picked: ${JSON.stringify(picked)}`)
  check('Enter tags Atlas: a chip, and "@At" gone from the box', picked.value === '' && picked.chips.length === 1 && /^@Atlas/.test(picked.chips[0]) && /conversation of their own/.test(picked.note), JSON.stringify(picked))

  const sent = JSON.parse(String(await drive.capture('Sent: Wren runs, Atlas is sent it too', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Atlas: what single word did Wren just reply with? Answer with that word only.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Start mission"]')?.click()
    let notice
    for (let i = 0; i < 40 && !notice; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      notice = document.querySelector('.lc-notice')
    }
    await new Promise((r) => setTimeout(r, 1500))
    const rows = ${conversationRows()}
    return JSON.stringify({
      placeholder: field.getAttribute('placeholder') ?? '',
      notice: notice?.textContent.trim() ?? '',
      plain: notice?.classList.contains('is-plain') ?? false,
      chips: document.querySelectorAll('.lc-tagged__chip').length,
      atlasRows: rows.filter((row) => row.owner === 'tm_atlas').map((row) => row.title),
      active: rows.find((row) => row.active)?.owner ?? ''
    })
  })()`))))
  say(`  sent: ${JSON.stringify(sent)}`)
  // While Wren runs the box says "it goes to Wren when this finishes"; idle, "Message Wren".
  check('the screen stays on Wren', /Wren/.test(sent.placeholder) && !/Atlas/.test(sent.placeholder) && sent.active === 'tm_wren', JSON.stringify(sent))
  check('"Sent to Atlas too." as a plain report, and the chip is gone', sent.notice === 'Sent to Atlas too.' && sent.plain && sent.chips === 0, JSON.stringify(sent))
  check('Atlas has a conversation of his own, titled by the message', sent.atlasRows.length === 1 && /what single word did Wren/.test(sent.atlasRows[0]), JSON.stringify(sent.atlasRows))

  // Both runs end; then Atlas's conversation is read.
  const settled = String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const busy = ${teammateRows()}.filter((mate) => !['idle', 'done'].includes(mate.activity))
      if (i > 6 && busy.length === 0) return 'settled'
    }
    return 'still running: ' + ${teammateRows()}.map((mate) => mate.name + ' ' + mate.activity).join(', ')
  })()`))
  say(`  ${settled}`)
  const atlas = String(await drive.capture("Atlas's own conversation", () => drive.evaluate(`(async () => {
    const row = ${conversationRows()}.find((one) => one.owner === 'tm_atlas')
    if (!row) return 'no Atlas conversation'
    row.click()
    await new Promise((r) => setTimeout(r, 1500))
    return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-500)
  })()`)))
  say(`  Atlas: ${atlas.slice(-250)}`)
  check(`Atlas, given Wren's latest answer, names ${WORD}`, atlas.includes(WORD), atlas.slice(-250))
  check("Atlas's bubble shows the message, not the context line", !/You were tagged in/.test(atlas), atlas.slice(0, 250))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren and Atlas on OpenCode / ${MODEL}, Ask.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
