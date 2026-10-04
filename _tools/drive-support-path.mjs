// A person can reach Locust's makers: the Help block, and a report by email or as a file (0.593, PRD R23).
//
//   node _tools/drive-support-path.mjs [--packaged <exe>] [--tag <name>]
//
// Settings > General must carry a Help block naming the support address and
// the public bug page. The Send feedback box must offer Send (GitHub), Email
// and Save as a file, all off until something is written. On a development
// build the save is scripted to a file (LOCUST_REPORT_PATH; a native dialog
// cannot be driven) and that file must hold the words, the version and the
// address to send it to. Sends nothing to any model; opens no browser or mail
// app (Send and Email are not pressed).

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-support-ws-')
const reportDir = await mkdtemp(join(tmpdir(), 'locust-drive-support-report-'))
const reportPath = join(reportDir, 'report.txt')
const drive = await startDrive({
  name: `support-path-${tag}`, port: 9861, workspace, sendsNothing: true,
  outPath: join(recordRoot('support-path-2026-10-04'), tag),
  env: { LOCUST_REPORT_PATH: reportPath },
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const WORDS = 'The composer stopped taking keys after the third run.'
try {
  await drive.ready()
  await drive.resize(1440, 900)
  const help = JSON.parse(String(await drive.capture('Settings > General: the Help block', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'General')?.click()
    await new Promise((r) => setTimeout(r, 900))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'Help')
    heading?.scrollIntoView()
    const section = heading?.closest('section')
    return JSON.stringify({ present: section !== undefined && section !== null, text: section?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 600) ?? '' })
  })()`))))
  check('Settings > General has a Help block', help.present === true, help.text)
  check('it names the support address and the public bug page', /support@locust\.lol/.test(help.text) && /GitHub issue/.test(help.text), help.text)
  const box = JSON.parse(String(await drive.capture('Send feedback: three ways, all off until words', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send feedback')?.click()
    await new Promise((r) => setTimeout(r, 700))
    const dialog = document.querySelector('.lc-feedback')
    if (!dialog) return JSON.stringify({ present: false })
    const buttons = () => [...dialog.querySelectorAll('button')].map((b) => ({ label: b.innerText.trim(), disabled: b.disabled }))
    const before = buttons()
    const field = dialog.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(WORDS)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    return JSON.stringify({ present: true, before, after: buttons(), claim: dialog.innerText.replace(/\\s+/g, ' ').trim().slice(0, 700) })
  })()`))))
  check('the box opens', box.present === true, JSON.stringify(box))
  const labels = (rows) => rows.map((b) => b.label)
  check('it offers Cancel, Save as a file, Email and Send', JSON.stringify(labels(box.before ?? [])) === JSON.stringify(['Cancel', 'Save as a file', 'Email', 'Send']), JSON.stringify(labels(box.before ?? [])))
  check('Save, Email and Send are off until something is written, then on', (box.before ?? []).filter((b) => b.label !== 'Cancel').every((b) => b.disabled) && (box.after ?? []).every((b) => !b.disabled), JSON.stringify({ before: box.before, after: box.after }))
  check('the box says where each way goes', /public GitHub issue/.test(box.claim) && /support@locust\.lol/.test(box.claim) && /Save as a file keeps all of it/.test(box.claim), box.claim)
  if (packaged === undefined) {
    const saved = String(await drive.capture('Save as a file (scripted on a development build)', () => drive.evaluate(`(async () => {
      const dialog = document.querySelector('.lc-feedback')
      ;[...dialog.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save as a file')?.click()
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 250))
        const status = dialog.querySelector('[role="status"]')
        if (status) return status.innerText.replace(/\\s+/g, ' ').trim()
      }
      return 'no status after 10 s: ' + dialog.innerText.replace(/\\s+/g, ' ').slice(0, 300)
    })()`)))
    check('the box says where the file went and where to send it', /^Saved to .*report\.txt\. Send it to support@locust\.lol/.test(saved), saved)
    await sleep(400)
    const file = await readFile(reportPath, 'utf8').catch(() => '')
    check('the file holds the words, the version and the address', file.includes(WORDS) && /Locust \d+\.\d+\.\d+ on /.test(file) && file.includes('Send it to support@locust.lol'), file.slice(0, 300).replace(/\n/g, ' | '))
  } else {
    say('  (packaged: Save as a file opens a native dialog, which a drive cannot answer; the file path is covered on the development build)')
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Settings > General Help block; Send feedback with Email and Save as a file; nothing sent to any model.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
