// Claude's cloud, sent from the chat box, known by its id (0.556).
//
//   node _tools/drive-claude-cloud-known-by-id.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: "this dumbass window pops up, makes me select a cloud
// folder, i do it again, try again, nothing happens". Clay on Claude Haiku,
// Cloud chosen, a one-word task sent from the box, in this checkout (a
// GitHub repository Claude Code already trusts): no Claude Code window
// opens; the panel's row carries the session's title and a box to tell it
// more; a follow-up goes; the session's link is its own.
//
// SPENDS one small Claude cloud session of the person's plan (a test about
// Claude's cloud runs on it).

import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// A checkout of a GitHub repository that Claude Code already trusts: this one by default, or --workspace. A folder it
// does not trust makes Claude Code ask, in its own window, and Locust never answers that for the person (2026-10-06:
// a fresh clone on C: was not trusted, and the window this drive counts opened for the question).
const workspace = resolve(process.argv.includes('--workspace') ? process.argv[process.argv.indexOf('--workspace') + 1] : resolve(import.meta.dirname, '..'))

/** Claude Code windows: a console kept open (/k) running --cloud or --teleport. The hidden one runs /c. */
const claudeWindows = () => {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match '/k' -and $_.CommandLine -match '--cloud|--teleport' }).Count"], { encoding: 'utf8' })
  return Number(out.trim())
}

/** The hidden start's command line, while it runs (about four seconds): '' when none is running. */
const hiddenStart = () => execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match '/c' -and $_.CommandLine -match '--cloud' } | Select-Object -First 1).CommandLine"], { encoding: 'utf8' }).trim()

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `claude-cloud-known-${tag}`,
  port: 9861,
  workspace,
  spends: true,
  outPath: join(recordRoot('claude-cloud-known-by-id-2026-10-02'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_clay', name: 'Clay', hue: 'violet', role: 'Custom', roleTitle: 'Code', createdAt: '2026-10-02T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const setText = (selector, text) => `(() => {
  const field = document.querySelector(${JSON.stringify(selector)})
  if (!field) return false
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
try {
  const before = claudeWindows()
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(`(async () => {
    const clay = [...document.querySelectorAll('button')].find((b) => /Clay/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    clay?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 1
  })()`)
  await drive.waitFor(`!!document.querySelector('.lc-control--chatmode')`, { timeoutMs: 60_000, what: 'the chat-type chip' })
  const menu = String(await drive.capture('the chat-type menu', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return [...document.querySelectorAll('.lc-menu__item')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')
  })()`)))
  check('Cloud promises no window', /Cloud Runs in Claude’s cloud; follow it on claude\.ai/.test(menu) && !/window/.test(menu), menu)
  await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-menu__item')].find((b) => /^Cloud/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 1
  })()`)
  const typed = await drive.evaluate(setText('form.command-dock textarea', 'Reply with the single word ok. Change nothing.'))
  await sleep(400)
  await drive.capture('Task written, Cloud on', () => drive.evaluate(`(() => { document.querySelector('form.command-dock')?.requestSubmit(); return 1 })()`))
  // While it starts: no Claude Code window, and (0.557) the box's model goes with it.
  let windowsSeen = 0
  let started = ''
  for (let waited = 0; waited < 20_000; waited += 1000) {
    await sleep(1000)
    windowsSeen = Math.max(windowsSeen, claudeWindows() - before)
    if (started === '') started = hiddenStart()
  }
  check('the task was written and sent', typed === true)
  check('no Claude Code window opened', windowsSeen === 0, `windows: ${String(windowsSeen)}`)
  check('the session starts on the model picked in the box', /--model haiku/.test(started) && /--cloud/.test(started), started)
  await drive.waitFor(`!!document.querySelector('.lc-cloudtask__more')`, { timeoutMs: 60_000, what: 'the session row with its box' })
  const row = JSON.parse(String(await drive.capture('The session, known', () => drive.evaluate(`JSON.stringify({
    title: document.querySelector('.lc-cloudtask__title')?.textContent ?? '',
    text: document.querySelector('.lc-cloudtask')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
  })`))))
  check('the row carries the session’s title, and says where its replies are', row.title.length > 0 && /In Claude’s cloud since /.test(row.text) && /Show what it did/.test(row.text), JSON.stringify(row))
  const listed = JSON.parse(String(await drive.evaluate(`window.desktop.listClaudeCloud().then((all) => JSON.stringify(all[0] ?? {}))`)))
  check('its link is the session’s own', /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+$/.test(listed.url ?? '') && listed.url.endsWith(listed.sessionId), JSON.stringify(listed))
  await drive.evaluate(setText('.lc-cloudtask__more input', 'Thanks, nothing more.'))
  await sleep(300)
  await drive.evaluate(`(() => { document.querySelector('.lc-cloudtask__more')?.requestSubmit(); return 1 })()`)
  await drive.waitFor(`/Sent\\. Check again|did not send/.test(document.querySelector('.lc-cloudtask')?.innerText ?? '')`, { timeoutMs: 120_000, what: 'the follow-up answer' })
  const after = String(await drive.capture('Follow-up sent', () => drive.evaluate(`document.querySelector('.lc-cloudtask')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)))
  check('a follow-up goes to the session', /Sent\. Check again in a moment/.test(after), after)
  check('still no Claude Code window', claudeWindows() - before === 0)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Clay on Claude Haiku; Cloud chosen; a one-word task sent from the box in this checkout; one follow-up.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
