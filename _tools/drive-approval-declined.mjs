// Is a change the person declined recorded as declined (M2)?
//
//   LOCUST_SPEND=1 node _tools/drive-approval-declined.mjs [--packaged <exe>] [--tag <name>]
//
// Wren on Codex CLI in Approve-each is asked to create one file. The person
// DECLINES the card. Codex reports the item "declined", and that was recorded
// as a completed tool -- with its diff attached -- so the fold said the file
// was edited and drew the line that was never written.
//
// Spends one short Codex run on the affordable model at low effort, as
// drive-approval does (Colin, 2026-09-08: "use cheap models especially for
// codex").

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `approval-declined-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-declined-ws-')
const drive = await startDrive({
  spends: true,
  name: 'approval-declined',
  port: 9591,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'approve-each', effort: 'low' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 6, memoryMode: 'off' }
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
  await sleep(1200)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  const card = String(await drive.capture('ask for a new file and wait for the card', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Using your file-editing tool (apply_patch), create a new file named HELLO.txt in this directory containing exactly the line: hello from wren. Do not run shell commands and do not ask me anything first. If the change is declined, stop and say so.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const approval = document.querySelector('[role=group][aria-label="Approval required"]')
      if (approval) {
        await new Promise(r => setTimeout(r, 400))
        return 'card: ' + approval.innerText.replace(/\\s+/g, ' ').slice(0, 200)
      }
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'run ended with no card'
    }
    return 'no card within 4 minutes'
  })()`)))
  check('the run stopped at an approval card', /^card:/.test(card), card)
  const declined = String(await drive.capture('decline every card, and wait for the run to finish', () => drive.evaluate(`(async () => {
    let denied = 0
    for (let i = 0; i < 600; i += 1) {
      const approval = document.querySelector('[role=group][aria-label="Approval required"]')
      const deny = approval?.querySelector('button.lc-denybutton:not([disabled])')
      if (deny && denied < 4) { deny.click(); denied += 1; await new Promise(r => setTimeout(r, 900)); continue }
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'ended after ' + String(denied) + ' decline(s)'
      await new Promise(r => setTimeout(r, 500))
    }
    return 'still running after ' + String(denied) + ' decline(s)'
  })()`)))
  say(`  ${declined}`)
  await sleep(1000)
  const fold = String(await drive.capture('open the activity fold', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-activity')
    if (!fold) return 'no activity fold'
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 400))
    return fold.innerText.replace(/\\s+/g, ' ').slice(0, 500)
  })()`)))
  say(`  fold: ${fold.slice(0, 300)}`)
  check('the file was not written', !existsSync(join(workspace, 'HELLO.txt')))
  // On 0.335 this read "1 file +1 −0": a file counted, and a line added, that never was.
  check('the fold does not count a file or a line that was never written', !/Edited 1 file|\b1 file\b|\+1 /.test(fold), fold.slice(0, 120))
  check('the fold draws no line that was never written', !/\+\s*hello from wren/.test(fold))
  say(failures === 0 ? '\nAPPROVAL DECLINED PASSED' : `\nAPPROVAL DECLINED: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Codex CLI (gpt-5.6-luna, low), Approve each action, asked to create HELLO.txt; every card declined.` })
}
