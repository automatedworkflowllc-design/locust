// Land it: a teammate's own branch onto the person's, as one commit (0.440).
//
//   node _tools/drive-land.mjs [--packaged <exe>] [--tag <name>]
//
// Free model (LOCUST_FREE_MODEL, Nemotron by default): spends nothing.
//
// Idea #2 of PRODUCT-SUGGESTIONS-2026-09-28, held to Colin's bar the same
// day: "if we cant make it clean and seamless, we dont do it". Wren, on her
// own branch, changes cart.py. Then, in order:
//   - the person has an unsaved edit to cart.py: the card says so in place
//     of the button, and nothing is touched;
//   - the person commits a different change to the same line: the card names
//     the conflict and offers "Ask Wren to resolve", which asks in her
//     conversation; when that turn ends the card offers Land again by itself;
//   - Land lands it: one commit on main by the person, cart.py without a
//     conflict marker, and Wren's branch has nothing left to land.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('land-2026-09-28'), `land-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-land-ws-')
await writeFile(join(workspace, 'cart.py'), 'def total(items):\n    return 0\n', 'utf8')
await writeFile(join(workspace, 'README.md'), '# shop\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'cart'], workspace)

const drive = await startDrive({
  name: `land-${tag}`, port: 9775, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', worktree: true, route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const text = async (path) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')
/** The land card as the person sees it, after reading the branch again. */
const card = (reread = true) => `(async () => {
  if (${reread ? 'true' : 'false'}) document.querySelector('aside[aria-label="Review changes"] button[aria-label="Read it again"]')?.click()
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    if (document.querySelector('.lc-land') || document.querySelector('aside[aria-label="Review changes"] .lc-review__note.is-done')) break
  }
  await new Promise((r) => setTimeout(r, 600))
  const land = document.querySelector('.lc-land')
  return JSON.stringify({
    open: document.querySelector('aside[aria-label="Review changes"]') !== null,
    card: land?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    buttons: [...(land?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
    turns: [...document.querySelectorAll('.lc-review__turn')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()),
    done: document.querySelector('aside[aria-label="Review changes"] .lc-review__note.is-done')?.textContent.trim() ?? ''
  })
})()`
const press = (label) => `(async () => {
  const button = [...document.querySelectorAll('.lc-land button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!button) return 'no button ' + ${JSON.stringify(label)}
  button.click()
  await new Promise((r) => setTimeout(r, 1200))
  return 'pressed'
})()`
const waitIdle = `(async () => {
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  for (let i = 0; i < 720; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (!document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 2500))
  return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-300)
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await sleep(800)

  const one = String(await drive.evaluate(sendAndWaitScript('In cart.py, change `return 0` to `return sum(items)`. Change nothing else and do not run anything.', { waitSeconds: 300 })))
  say(`  turn 1: ${one.slice(-140)}`)
  check("Wren's turn is saved on her branch", (await git(['rev-list', '--count', 'main..locust/wren'], workspace).catch(() => '0')).trim() === '1')

  // 1. Your own unsaved edit to the file it would write.
  await writeFile(join(workspace, 'cart.py'), 'def total(items):\n    return 0  # mine, unsaved\n', 'utf8')
  await drive.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Review changes')?.click()`)
  await sleep(1500)
  const yours = JSON.parse(String(await drive.capture('Your unsaved edit is in the way', () => drive.evaluate(card()))))
  say(`  yours: ${JSON.stringify(yours)}`)
  check('your unsaved edit to cart.py is named in place of the button', /You have unsaved changes in cart\.py/.test(yours.card) && !yours.buttons.some((b) => /^Land on/.test(b)), JSON.stringify(yours))
  check('and nothing was touched', (await text(join(workspace, 'cart.py'))) === 'def total(items):\n    return 0  # mine, unsaved\n')
  await git(['checkout', '--', 'cart.py'], workspace)

  // 2. You change the same line, committed.
  await writeFile(join(workspace, 'cart.py'), 'def total(items):\n    return len(items)\n', 'utf8')
  await git(['commit', '-q', '-am', 'count them'], workspace)
  const head = (await git(['rev-parse', 'HEAD'], workspace)).trim()
  const conflict = JSON.parse(String(await drive.capture('A conflict, offered to Wren', () => drive.evaluate(card()))))
  say(`  conflict: ${JSON.stringify(conflict)}`)
  check('the conflict is named, and Wren is offered it', /cart\.py was changed on main too/.test(conflict.card) && conflict.buttons.includes('Ask Wren to resolve'), JSON.stringify(conflict))
  check('your checkout untouched by the check', (await git(['rev-parse', 'HEAD'], workspace)).trim() === head && (await git(['status', '--porcelain'], workspace)).trim() === '')

  say(`  ${String(await drive.evaluate(press('Ask Wren to resolve')))}`)
  const resolved = String(await drive.capture("Wren's turn resolves it", () => drive.evaluate(waitIdle)))
  say(`  resolve turn: ${resolved.slice(-200)}`)
  const ready = JSON.parse(String(await drive.capture('After the turn: Land offered again, by itself', () => drive.evaluate(card(false)))))
  say(`  ready: ${JSON.stringify(ready)}`)
  check('when the turn ends, the card offers Land again without a press', ready.buttons.includes('Land on main'), JSON.stringify(ready))
  // The first build read the branch before the turn's checkpoint was made, and showed the old diff.
  check('and the panel shows the merge that turn saved', ready.turns.some((row) => /merge with main/.test(row)), JSON.stringify(ready.turns))
  check('your checkout still untouched', (await git(['rev-parse', 'HEAD'], workspace)).trim() === head && (await git(['status', '--porcelain'], workspace)).trim() === '')

  // 3. Land it.
  await drive.evaluate(press('Land on main'))
  const editing = JSON.parse(String(await drive.capture('The commit, before it is made', () => drive.evaluate(`JSON.stringify({ message: document.querySelector('.lc-land__message')?.value ?? '' })`))))
  say(`  message: ${JSON.stringify(editing.message)}`)
  check('the drafted message carries the ask and the teammate', /cart\.py/.test(editing.message) && /Locust-Teammate: Wren/.test(editing.message), JSON.stringify(editing.message))
  check('and reads cleanly: a whole first sentence, the runtime named once, no resolve step', !/…/.test(editing.message.split('\n')[0]) && !/opencode \/ opencode\//.test(editing.message) && !/Merging main/.test(editing.message), JSON.stringify(editing.message))
  await drive.evaluate(press('Land it'))
  const landed = JSON.parse(String(await drive.capture('Landed', () => drive.evaluate(card(false)))))
  say(`  landed: ${JSON.stringify(landed)}`)
  check('the panel says it landed, on main, as one commit of yours', /^Landed on main as [0-9a-f]{7}: /.test(landed.done), JSON.stringify(landed))
  const log = (await git(['log', '--format=%an|%s', `${head}..main`], workspace)).trim().split('\n').filter(Boolean)
  say(`  main since yours: ${JSON.stringify(log)}`)
  check('git: exactly one new commit on main, made as you', log.length === 1 && log[0].startsWith('Locust drive|'), JSON.stringify(log))
  const cart = await text(join(workspace, 'cart.py'))
  check('cart.py landed without a conflict marker', !/<<<<<<<|>>>>>>>|=======/.test(cart) && cart !== 'def total(items):\n    return len(items)\n', JSON.stringify(cart))
  check("git: Wren's branch has nothing left to land", (await git(['rev-list', '--count', 'main..locust/wren'], workspace)).trim() === '0')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on OpenCode / ${MODEL}, Accept edits, Own branch on; a small repository with cart.py.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
