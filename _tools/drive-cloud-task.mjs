// A cloud task from the chat-type menu, followed to Ready, shown, and applied (0.503).
//
//   LOCUST_SPEND=1 node _tools/drive-cloud-task.mjs --repo <a clone of a GitHub repo with a Legacy Codex Cloud environment> [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30: cloud agents "in the dropdown where you select chat
// type". Cloud is picked in that menu; a task is sent; the Cloud tasks panel
// must show it working, then Ready with its change counted; Show the change
// must draw the diff; Apply must bring it into the folder -- and not before.
// Spends one Codex Cloud task. The clone is put back afterwards.

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openTeammateScript, recordRoot, say, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const repo = arg('--repo')
if (repo === undefined) {
  say('usage: LOCUST_SPEND=1 node _tools/drive-cloud-task.mjs --repo <clone> [--packaged <exe>]')
  process.exit(2)
}
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
git('checkout', '--', '.')
const before = await readFile(join(repo, 'greet.js'), 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `cloud-task-${tag}`,
  port: 9807,
  workspace: repo,
  spends: true,
  outPath: join(recordRoot('cloud-task-2026-09-30'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_coda', name: 'Coda', hue: 'teal', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 240)}`}`)
}
const panel = `JSON.stringify({
  open: !!document.querySelector('.lc-cloudtasks'),
  head: document.querySelector('.lc-cloudtasks .lc-beside__title')?.innerText.trim() ?? null,
  tasks: [...document.querySelectorAll('.lc-cloudtask')].map((el) => ({ state: (el.className.match(/is-(\\w+)/) || [])[1], line: el.querySelector('.lc-cloudtask__state')?.innerText.trim() })),
  files: document.querySelectorAll('.lc-cloudtask .lc-review__files section').length,
  problem: document.querySelector('.lc-cloudtasks__problem')?.innerText.trim() ?? null
})`
const read = async (title) => JSON.parse(String(await drive.capture(title, () => drive.evaluate(panel))))

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Coda'))
  const picked = String(await drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('.lc-menu [role="menuitemradio"]')].find((el) => /^Cloud/.test(el.innerText.trim()))
    if (!item) return 'no Cloud in the menu: ' + [...document.querySelectorAll('.lc-menu [role="menuitemradio"]')].map((el) => el.innerText.split('\\n')[0]).join(', ')
    item.click()
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? ''
  })()`))
  check('Cloud is in the chat-type menu, and picking it says where the task goes', /Codex Cloud/.test(picked), picked)
  const opened = await read('Cloud picked: the panel')
  check('the Cloud tasks panel opens on this repository', opened.open && /locust-cloud-test/.test(opened.head ?? ''), JSON.stringify(opened))

  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'In greet.js add an exported function farewell(name) that returns "Goodbye, <name>." and add a test for it to greet.test.js. Run npm test.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) {
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
      await new Promise((r) => setTimeout(r, 250))
    }
    await new Promise((r) => setTimeout(r, 8000))
  })()`)
  const started = await read('sent: the task in the panel')
  check('the task shows in the panel, working in the cloud', started.tasks.length === 1 && started.tasks[0].state === 'pending', JSON.stringify(started))

  let ready = started
  for (let i = 0; i < 30 && ready.tasks[0]?.state === 'pending'; i += 1) {
    await new Promise((r) => setTimeout(r, 15_000))
    ready = JSON.parse(String(await drive.evaluate(panel)))
  }
  await drive.capture('Ready', () => drive.evaluate(panel))
  check('it reaches Ready with its change counted', ready.tasks[0]?.state === 'ready' && /\+\d+ −\d+ in \d+ files?/.test(ready.tasks[0]?.line ?? ''), JSON.stringify(ready.tasks))
  check('and nothing came into the folder before Apply', (await readFile(join(repo, 'greet.js'), 'utf8')) === before)

  const shown = JSON.parse(String(await drive.capture('Show the change', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-cloudtask button')].find((b) => /Show the change/.test(b.innerText))?.click()
    for (let i = 0; i < 60 && !document.querySelector('.lc-cloudtask .lc-review__files section'); i += 1) await new Promise((r) => setTimeout(r, 500))
    return ${panel}
  })()`))))
  check('Show the change draws its files', shown.files >= 1, JSON.stringify(shown))

  const applied = JSON.parse(String(await drive.capture('Applied', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-cloudtask button')].find((b) => /Apply to this folder/.test(b.innerText))?.click()
    for (let i = 0; i < 120 && !document.querySelector('.lc-cloudtask.is-applied') && !document.querySelector('.lc-cloudtasks__problem'); i += 1) await new Promise((r) => setTimeout(r, 500))
    return ${panel}
  })()`))))
  const after = await readFile(join(repo, 'greet.js'), 'utf8')
  check('Apply brings the change into the folder', applied.tasks[0]?.state === 'applied' && /farewell/.test(after), JSON.stringify({ applied, has: /farewell/.test(after) }))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Coda on Codex, in ${repo}.`, extra: `Checks failed: ${String(failures)}` })
  // The clone as it was: the applied change is left uncommitted by design, and removed here.
  try { git('checkout', '--', '.'); git('clean', '-fd', '--exclude=error.log') } catch { /* left for a person */ }
}
if (failures > 0) process.exitCode = 1
