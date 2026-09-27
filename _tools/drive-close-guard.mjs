// Closing the window while a teammate works asks first (0.382).
//
//   node _tools/drive-close-guard.mjs [--packaged <exe>] [--tag <name>]
//
// Free model. Two launches:
//   1. Sable is given a long job, and the window is closed the way the title
//      bar's X closes it (window.desktop.close()). The close must be HELD --
//      the page still answers -- because the native "Keep working / Quit
//      anyway" question is up. (A native dialog is not the page's, so the
//      drive cannot click it; the process is ended when the drive finishes.)
//   2. The control: nobody working, the same close -- the window must go,
//      and the app with it.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('close-guard-2026-09-26'), `close-guard-${tag}`)
await mkdir(OUT, { recursive: true })
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** Does the page still answer? A closed window cannot. */
const answers = async (drive) => {
  try {
    return String(await Promise.race([drive.evaluate('String(1 + 1)'), new Promise((_, reject) => setTimeout(() => reject(new Error('silent')), 4000))])) === '2'
  } catch {
    return false
  }
}

// 1. A teammate working: the close is held.
{
  const workspace = await scratchRepository('locust-close-guard-ws-')
  const drive = await startDrive({ name: `close-guard-${tag}`, port: 9685, workspace, launchElsewhere: true, outPath: OUT, ...(packaged === undefined ? {} : { packaged }), seed })
  try {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Sable'))
    const sent = String(await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Count from 1 to 400, one number per line, and nothing else. Do not use any tools.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 250))
        const button = document.querySelector('button[aria-label="Start mission"]')
        if (button && !button.disabled) { button.click(); return 'sent' }
      }
      return 'could not send'
    })()`))
    // Running: the Stop button is the sign.
    let running = false
    for (let i = 0; i < 60 && !running; i += 1) {
      running = String(await drive.evaluate(`String(!!document.querySelector('button[aria-label^="Stop the running"]'))`)) === 'true'
      if (!running) await sleep(500)
    }
    check('Sable is working', sent === 'sent' && running, `${sent}, running ${String(running)}`)
    await drive.capture('Sable working, before the close', () => 'running')
    void drive.evaluate('window.desktop.close()').catch(() => undefined)
    await sleep(2500)
    check('closing the window while Sable works is held: the page still answers', await answers(drive))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Sable on ${MODEL}, working; the window closed as the title bar closes it.`, last: false })
  }
}

// 2. The control: nobody working, the same close goes through.
{
  const workspace = await scratchRepository('locust-close-guard-ws-')
  const drive = await startDrive({ name: `close-guard-${tag}`, port: 9685, workspace, launchElsewhere: true, outPath: OUT, stepFrom: 1, ...(packaged === undefined ? {} : { packaged }), seed })
  try {
    await drive.ready()
    void drive.evaluate('window.desktop.close()').catch(() => undefined)
    await sleep(3500)
    check('the control: with nobody working, the same close goes straight through', !(await answers(drive)))
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'The control: nobody working, the same close.' }).catch(() => undefined)
  }
}
say(failures === 0 ? '\nCLOSE GUARD PASSED' : `\nCLOSE GUARD: ${String(failures)} FAILED`)
