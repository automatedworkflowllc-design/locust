// Fresh-eyes area 23: someone coding fixes a small bug, start to finish.
//
//   node _tools/drive-a-coder-fixes-a-bug.mjs [--packaged <exe>] [--tag <name>]
//
// A scratch project with a real bug and a test that catches it: a cart whose
// 10% discount takes $10 off. The person sets "Check after edits" to the
// project's tests in Settings, tells Ada (a free model, Edit) what customers
// see, and reads what comes back: the steps, the change, the check after the
// turn. The drive then runs the tests itself. Free model; nothing spent.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const model = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('a-coder-fixes-a-bug-2026-09-28'), `a-coder-fixes-a-bug-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-coder-ws-', 'A small shop. Run the tests with: node --test\n')
const BUGGY = [
  'function total(items, discountPercent = 0) {',
  '  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0)',
  '  return subtotal - discountPercent',
  '}',
  '',
  'module.exports = { total }',
  ''
].join('\n')
await writeFile(join(workspace, 'cart.js'), BUGGY, 'utf8')
await mkdir(join(workspace, 'test'), { recursive: true })
await writeFile(join(workspace, 'test', 'cart.test.js'), [
  "const test = require('node:test')",
  "const assert = require('node:assert')",
  "const { total } = require('../cart')",
  '',
  "test('no discount', () => assert.strictEqual(total([{ price: 10, qty: 2 }]), 20))",
  "test('10% off a $20 order is $18', () => assert.strictEqual(total([{ price: 10, qty: 2 }], 10), 18))",
  "test('25% off a $40 order is $30', () => assert.strictEqual(total([{ price: 20, qty: 2 }], 25), 30))",
  ''
].join('\n'), 'utf8')
await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'corner-shop', private: true, scripts: { test: 'node --test' } }, null, 2) + '\n', 'utf8')
await git(['add', '-A'], workspace)
await git(['commit', '-q', '-m', 'cart'], workspace)
const testsPass = () => {
  try { execFileSync(process.execPath, ['--test'], { cwd: workspace, stdio: 'pipe' }); return true } catch { return false }
}
const failingBefore = !testsPass()

const drive = await startDrive({
  name: `coder-${tag}`, port: 9753, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model, mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  check('the project starts with the bug: its tests fail', failingBefore)
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  const set = String(await drive.capture('Settings: check after edits = node --test', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Settings/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 900))
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => b.innerText.trim() === 'Project folder')?.click()
    await new Promise((r) => setTimeout(r, 700))
    const input = document.querySelector('input[aria-label="Check after edits"]')
    if (!input) return 'NO CHECK AFTER EDITS ROW'
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'node --test')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    input.closest('form').requestSubmit()
    await new Promise((r) => setTimeout(r, 900))
    return 'saved: ' + input.value
  })()`)))
  check('the check is set for this folder', /saved: node --test/.test(set), set)

  await drive.evaluate(openTeammateScript('Ada'))
  const ran = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Customers say the discount is wrong: 10% off a $20 order charges them $10 instead of $18. Find the bug and fix it. The tests are in test/.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
    }
    return 'timed out'
  })()`))
  await sleep(4000)
  const thread = String(await drive.capture('Ada’s turn, ended', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`)))
  say(`  turn: ${thread.slice(-600)}`)
  const cart = await readFile(join(workspace, 'cart.js'), 'utf8')
  check('the run ended and changed cart.js', ran === 'ended' && cart !== BUGGY, `${ran} || ${cart.split('\n')[2] ?? ''}`)
  check('the tests pass now, run by the drive itself', testsPass())
  check('the thread shows the change to cart.js', /cart\.js/.test(thread), thread.slice(0, 200))
  // 0.421: a note between steps with a code block showed its fences as text.
  check('no Markdown fence shows as text anywhere in the turn', !thread.includes('```'), (/.{0,60}```.{0,60}/.exec(thread) ?? [''])[0])

  const checked = String(await drive.capture('the check after the turn', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 60; i += 1) {
      const cards = [...document.querySelectorAll('.lc-editcheck')]
      if (cards.length > 0) return cards.map((c) => c.innerText.replace(/\\s+/g, ' ')).join(' ;; ')
      await new Promise((r) => setTimeout(r, 500))
    }
    return 'NO CHECK CARD'
  })()`)))
  say(`  check card: ${checked}`)
  check('after the turn, the check says the tests pass', /pass|ok|no new/i.test(checked) && !/fail/i.test(checked), checked)

  const diff = String(await drive.capture('Show the change', () => drive.evaluate(`(async () => {
    const show = [...document.querySelectorAll('button')].filter((b) => /Show the change/.test(b.innerText)).pop()
    show?.click()
    await new Promise((r) => setTimeout(r, 900))
    return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-500) ?? ''
  })()`)))
  check('Show the change shows the fixed line', /discountPercent/.test(diff), diff.slice(-240))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A cart whose 10% discount took $10 off, with tests; Ada on ${model}, Edit; check after edits = node --test.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
