// An edit can put back what the replies after it changed -- exactly, or not at all (0.502).
//
//   node _tools/drive-an-edit-puts-files-back.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30, asked whether editing an earlier message should undo
// the later replies' files: "what do you think?" -- yes, ticked on purpose,
// and only where the record makes it exact. Ash (a free model, Edit mode)
// makes notes.txt, changes it, and makes extra.txt; then extra.txt is
// changed by hand. The second message is edited with "Also put back" ticked:
// notes.txt must be back to its first words, extra.txt left as the person
// made it and named, and the thread must say both. Spends nothing.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-put-back-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `an-edit-puts-files-back-${tag}`,
  port: 9805,
  workspace,
  outPath: join(recordRoot('edit-an-earlier-message-2026-09-30'), `puts-files-back-${tag}`),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 240)}`}`)
}
const read = (name) => readFile(join(workspace, name), 'utf8').catch(() => undefined)
const flat = (text) => (text ?? '').replace(/\r\n/g, '\n').trim()

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.evaluate(sendAndWaitScript('Create a file named notes.txt whose entire content is the single line ALPHA. Do nothing else.'))
  await drive.evaluate(sendAndWaitScript('Change notes.txt so its entire content is the single line BETA. Do nothing else.'))
  await drive.evaluate(sendAndWaitScript('Create a file named extra.txt whose entire content is the single line GAMMA. Do nothing else.'))
  const made = { notes: flat(await read('notes.txt')), extra: flat(await read('extra.txt')) }
  check('the replies did what was asked: notes.txt BETA, extra.txt GAMMA', made.notes === 'BETA' && made.extra === 'GAMMA', JSON.stringify(made))
  // The person changes extra.txt after the replies.
  await writeFile(join(workspace, 'extra.txt'), 'GAMMA\nmine\n', 'utf8')

  const banner = JSON.parse(String(await drive.capture('Edit on the second message: the offer to put files back', () => drive.evaluate(`(async () => {
    const bubble = [...document.querySelectorAll('.lc-thread .lc-bubble')].find((el) => el.innerText.includes('BETA'))
    bubble?.querySelector('.lc-bubble__edit')?.click()
    await new Promise((r) => setTimeout(r, 700))
    const box = document.querySelector('.lc-queued__check input')
    return JSON.stringify({ label: document.querySelector('.lc-queued__check')?.innerText.trim() ?? null, ticked: box?.checked ?? null })
  })()`))))
  check('the banner offers to put back the 2 files, unticked', /put back the 2 files/.test(banner.label ?? '') && banner.ticked === false, JSON.stringify(banner))

  const sent = String(await drive.capture('ticked and sent', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-queued__check input')?.click()
    await new Promise((r) => setTimeout(r, 300))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with the single word DONE. Do not touch any file.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Start mission"]')?.click()
    await new Promise((r) => setTimeout(r, 2500))
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return [...document.querySelectorAll('.lc-thread .lc-thread__note')].map((el) => el.innerText.trim()).join(' / ')
  })()`)))
  const after = { notes: flat(await read('notes.txt')), extra: flat(await read('extra.txt')) }
  check('notes.txt is back to what the first reply made', after.notes === 'ALPHA', JSON.stringify(after))
  check('extra.txt, changed by the person since, is left as they made it', after.extra === 'GAMMA\nmine', JSON.stringify(after))
  check('the thread says one file was put back', /1 file they changed was put back/.test(sent), sent)
  check('and names the one left alone, and why', /extra\.txt \(it was changed after those replies\)/.test(sent), sent)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
