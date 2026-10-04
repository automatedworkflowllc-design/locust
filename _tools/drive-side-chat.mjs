// Ask on the side (0.461): a question about a conversation, answered from a
// COPY of its session while the conversation keeps working.
//
//   node _tools/drive-side-chat.mjs [--packaged <exe>]
//
// Ash (the free OpenCode model) is told a codename, then set a long task. While
// that task runs, "Ask on the side" (the conversation's ... menu) asks for the
// codename: the answer must come from the copy, the conversation's own run
// must carry on and finish, the side question must never appear in the
// sidebar, and -- read from OpenCode's own export of the ORIGINAL session --
// the conversation must never have been asked it.

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await scratchRepository('locust-drive-side-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'side-chat', port: 9667, workspace, launchElsewhere: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const QUESTION = 'What is the project codename I gave you? Answer with the one word.'

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(openTeammateScript('Ash'))
  const told = String(await drive.capture('Ash is told a codename', () => drive.evaluate(sendAndWaitScript('The project codename is MARZIPAN. Reply with the single word NOTED.'))))
  check('the first turn finished', /NOTED/i.test(told), told.slice(-60))

  // A long turn, so the side question is asked WHILE the conversation works.
  await drive.evaluate(sendAndWaitScript('Run this exact shell command once: ping -n 40 127.0.0.1 . Then reply with the single word FINISHED.', { settle: false }))
  await new Promise((r) => setTimeout(r, 6000))

  const asked = JSON.parse(String(await drive.capture('Ask on the side, while the conversation works', () => drive.evaluate(`(async () => {
    const running = !!document.querySelector('button[aria-label^="Stop the running"]')
    document.querySelector('button[aria-label="More actions"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('.lc-context__item')].find((one) => one.textContent.trim() === 'Ask on the side')
    item?.click()
    await new Promise((r) => setTimeout(r, 500))
    const box = document.querySelector('.lc-sidechat__box')
    if (!box) return JSON.stringify({ running, item: !!item, panel: false })
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, ${JSON.stringify(QUESTION)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    document.querySelector('.lc-sidechat__send')?.click()
    for (let i = 0; i < 360; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const answer = document.querySelector('.lc-sidechat .lc-beside__thread')?.innerText ?? ''
      if (i > 6 && /MARZIPAN/i.test(answer) && document.querySelector('.lc-sidechat__box')?.placeholder !== 'Answering...') break
    }
    return JSON.stringify({
      running,
      item: !!item,
      panel: true,
      answer: (document.querySelector('.lc-sidechat .lc-beside__thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-200),
      problem: document.querySelector('.lc-sidechat__problem')?.textContent ?? '',
      mainStillRunning: !!document.querySelector('button[aria-label^="Stop the running"]'),
      sidebarRows: [...document.querySelectorAll('.lc-convrow')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim())
    })
  })()`))))
  say(`  asked: ${JSON.stringify(asked)}`)
  check('the ... menu offers Ask on the side while the conversation runs', asked.running === true && asked.item === true && asked.panel === true, JSON.stringify({ running: asked.running, item: asked.item }))
  check('the side answer comes from the copy: it knows the codename', /MARZIPAN/i.test(asked.answer ?? '') && (asked.problem ?? '') === '', JSON.stringify({ answer: asked.answer, problem: asked.problem }))
  check('the side question is never a conversation in the sidebar', (asked.sidebarRows ?? []).length === 1 && !(asked.sidebarRows ?? []).some((row) => /codename I gave/i.test(row)), JSON.stringify(asked.sidebarRows))

  const finished = String(await drive.capture('the conversation carries on and finishes', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise((r) => setTimeout(r, 800))
    return document.querySelector('main .lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-160) ?? ''
  })()`)))
  check('the conversation finished its own task', /FINISHED/i.test(finished), finished.slice(-80))

  // From OpenCode's own record: the ORIGINAL session never held the side question.
  const ledger = join(drive.profile, 'mission-ledger')
  const files = execFileSync('cmd', ['/c', 'dir', '/b', ledger], { encoding: 'utf8' }).split(/\r?\n/).filter((name) => name.endsWith('.jsonl'))
  const records = await Promise.all(files.map(async (name) => (await readFile(join(ledger, name), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))))
  const created = records.map((lines) => lines.find((line) => line.recordType === 'mission.created')?.metadata).filter(Boolean)
  const side = created.filter((meta) => meta.startedBy?.kind === 'side')
  const mainSessions = new Set(records.filter((lines) => lines.find((line) => line.recordType === 'mission.created')?.metadata?.startedBy?.kind !== 'side')
    .flatMap((lines) => lines.flatMap((line) => (line.events ?? [line.event]).filter(Boolean)).map((event) => event?.payload?.runtimeThreadId).filter((id) => typeof id === 'string')))
  check('the side question is recorded as side, read-only', side.length === 1 && side[0].sandbox === 'read-only' && side[0].continuesFrom === undefined, JSON.stringify(side.map((meta) => ({ startedBy: meta.startedBy, sandbox: meta.sandbox }))))
  const exported = [...mainSessions].map((id) => {
    try { return execFileSync('opencode', ['export', id], { encoding: 'utf8', cwd: workspace, shell: true }) } catch { return '' }
  })
  check('the conversation\'s own session never held the side question', exported.length > 0 && exported.some((text) => text.length > 0) && !exported.some((text) => text.includes('codename I gave you')), `${String(mainSessions.size)} session(s) read`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
