// `@` in the composer attaches a file of the project (0.436).
//
//   node _tools/drive-at-a-file.mjs [--packaged <exe>] [--tag <name>]
//
// Free model (LOCUST_FREE_MODEL, Nemotron by default): spends nothing.
//
// Yoinked at Colin's "anything to yoink" from VelaTerm's as-you-type path
// completion, the way Claude Code's composer does it. The folder is a small
// repository whose .gitignore leaves out node_modules. Typing "@car" must
// offer src/cart.py first; Enter must attach it and take "@car" out of the
// message; "@index" must offer nothing from node_modules; and the teammate,
// sent the message, must answer about the attached file.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('at-a-file-2026-09-28'), `at-a-file-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-at-file-ws-')
await mkdir(join(workspace, 'src'), { recursive: true })
await mkdir(join(workspace, 'node_modules', 'left-pad'), { recursive: true })
await writeFile(join(workspace, '.gitignore'), 'node_modules/\n', 'utf8')
await writeFile(join(workspace, 'src', 'cart.py'), 'def total(items):\n    return sum(item["price"] * item["qty"] for item in items)\n', 'utf8')
await writeFile(join(workspace, 'src', 'cart_test.py'), 'from cart import total\n', 'utf8')
await writeFile(join(workspace, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'cart'], workspace)

const drive = await startDrive({
  name: `at-a-file-${tag}`, port: 9772, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'ask' } }],
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
  const rows = [...document.querySelectorAll('.lc-slash[aria-label="Files"] .lc-slash__item')].map((row) => row.getAttribute('title'))
  return JSON.stringify({ open: document.querySelector('.lc-slash[aria-label="Files"]') !== null, rows })
})()`
const press = (key) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 600))
  return JSON.stringify({
    value: field.value,
    attached: [...document.querySelectorAll('.lc-attached [title], .lc-attached .lc-attached__name')].map((el) => el.getAttribute('title') ?? el.textContent.trim()),
    tiles: document.querySelector('.lc-attached')?.getAttribute('aria-label') ?? ''
  })
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Ada'))
  await sleep(800)

  const offered = JSON.parse(String(await drive.capture('Typing @car', () => drive.evaluate(type('What does the function in @car')))))
  say(`  @car: ${JSON.stringify(offered)}`)
  check('@car offers the project\'s cart files, src/cart.py first', offered.open && offered.rows[0] === 'src/cart.py' && offered.rows.includes('src/cart_test.py'), JSON.stringify(offered))

  const ignored = JSON.parse(String(await drive.evaluate(type('@index'))))
  check('nothing .gitignore leaves out is offered', !ignored.rows.some((row) => /node_modules/.test(row ?? '')), JSON.stringify(ignored))

  await drive.evaluate(type('What does the function in @car'))
  const picked = JSON.parse(String(await drive.capture('Enter attaches it', () => drive.evaluate(press('Enter')))))
  say(`  picked: ${JSON.stringify(picked)}`)
  check('Enter attaches src/cart.py and takes "@car" out of the message', picked.value === 'What does the function in ' && /1 file/.test(picked.tiles), JSON.stringify(picked))

  const answered = String(await drive.capture('Sent: Ada answers about the file', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, field.value + 'this file do? One sentence.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Send"]')?.click()
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise((r) => setTimeout(r, 2000))
    return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-400)
  })()`)))
  say(`  answer: ${answered.slice(-250)}`)
  check('Ada answers about the attached file: a total of price times quantity', /total|sum/i.test(answered) && /price|qty|quantit/i.test(answered), answered.slice(-250))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on OpenCode / ${MODEL}, Ask; a small repository whose .gitignore leaves out node_modules.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
