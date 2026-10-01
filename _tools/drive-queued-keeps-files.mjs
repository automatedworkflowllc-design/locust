// Does a message queued with a file attached keep the file (L20)?
//
//   node _tools/drive-queued-keeps-files.mjs [--packaged <exe>] [--tag <name>]
//
// Wren is busy on a slow count. The person attaches NOTES.md and asks what
// it says; the question is queued behind the run. The queue took the words
// and dropped the file, and the file tile stayed in the box, to ride along on
// whatever was sent next. So the queued question went without its file, and
// the passphrase in it never came back.
//
// On the free OpenCode model: nothing is spent. The OS file dialog cannot be
// driven, so the host is told what it would have returned
// (LOCUST_ATTACH_PATHS), as drive-attach-sent does.

import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `queued-keeps-files-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-queuedfiles-ws-')
await writeFile(join(workspace, 'NOTES.md'), '# Notes' + String.fromCharCode(10, 10) + 'The passphrase is OSPREY-5573.' + String.fromCharCode(10), 'utf8')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-queuedfiles-profile-'))
const drive = await startDrive({
  name: 'queued-keeps-files',
  profilePath,
  port: 9597,
  workspace,
  env: { LOCUST_ATTACH_PATHS: workspace + String.fromCharCode(47) + 'NOTES.md' },
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.capture('Wren starts a slow count', () => drive.evaluate(sendAndWaitScript('Count from 1 to 300, one number per line, with no other text. Do not edit any files.', { settle: false })))
  const live = String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 160; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'live'
    }
    return 'NOT LIVE'
  })()`))
  check('the premise: a run is live to queue behind', live === 'live', live)
  const queued = String(await drive.capture('attach NOTES.md and queue a question about it', () => drive.evaluate(`(async () => {
    document.querySelector('button[data-satellite="attach"]')?.click()
    await new Promise(r => setTimeout(r, 900))
    const box = document.querySelector('textarea[aria-label="Message"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'What is the passphrase in the attached file? Reply with the passphrase only. Do not edit any files.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 1200))
    return JSON.stringify({
      queued: document.querySelector('.lc-queued__text')?.textContent?.trim().slice(0, 80) ?? 'nothing queued',
      tilesLeft: document.querySelectorAll('.lc-attached__tile').length
    })
  })()`)))
  say(`  ${queued}`)
  const q = JSON.parse(queued)
  check('the question is queued', q.queued !== 'nothing queued', q.queued)
  check('the file tile left the box with it', q.tilesLeft === 0, `${String(q.tilesLeft)} tile(s) left in the box`)
  const answer = String(await drive.capture('both turns finish', () => drive.evaluate(`(async () => {
    let quiet = 0
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const busy = document.querySelector('button[aria-label^="Stop the running"]') || document.querySelector('.lc-queued__text')
      quiet = busy ? 0 : quiet + 1
      if (quiet >= 4) break
    }
    return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-300)
  })()`)))
  // The recorded prompt, not the answer: a model that goes looking can find
  // NOTES.md by itself, which is what it did on 0.336 with no file sent.
  let sentWith = 'no queued turn recorded'
  for (const name of await readdir(join(profilePath, 'mission-ledger')).catch(() => [])) {
    if (!name.endsWith('.jsonl')) continue
    const first = (await readFile(join(profilePath, 'mission-ledger', name), 'utf8')).split(String.fromCharCode(10))[0]
    try {
      const prompt = String(JSON.parse(first).metadata?.prompt ?? '')
      if (/passphrase/.test(prompt)) sentWith = prompt.slice(0, 160)
    } catch { /* not a ledger file */ }
  }
  say(`  answer: ${answer.slice(-120)}`)
  check('the queued question went with its file', /NOTES\.md/.test(sentWith), sentWith)
  say(failures === 0 ? '\nQUEUED KEEPS FILES PASSED' : `\nQUEUED KEEPS FILES: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren busy on the free model; NOTES.md attached and a question about it queued behind the run.` })
}
