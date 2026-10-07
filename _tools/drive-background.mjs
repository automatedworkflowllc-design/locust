// Keep working in the background (0.397).
//
//   node _tools/drive-background.mjs [--packaged <exe>] [--tag <name>]
//
// Free model. The close question's first answer now closes the WINDOW and
// keeps Locust in the tray while the work goes on. A native dialog is not the
// page's, so the drive names the button it would press through
// LOCUST_CLOSE_ANSWER -- the test seam, read nowhere else.
//   1. background: Sable counts; the window is closed; the page must still
//      answer (Locust is up), the window must be hidden, and Sable's run
//      must finish in the ledger while nobody can see it.
//   2. the control, cancel: the same close leaves the window where it was.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const { createFileMissionLedger } = await import('../packages/mission-store/dist/index.js')
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('background-2026-09-27'), `background-${tag}`)
await mkdir(OUT, { recursive: true })
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const answers = async (drive) => {
  try {
    return String(await Promise.race([drive.evaluate('String(1 + 1)'), new Promise((_, reject) => setTimeout(() => reject(new Error('silent')), 4000))])) === '2'
  } catch {
    return false
  }
}
const startCounting = (drive) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Count from 1 to 150, one number per line, and nothing else. Do not use any tools.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); break }
  }
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (document.querySelector('button[aria-label^="Stop the running"]')) return 'running'
  }
  return 'never started'
})()`)

async function launch(answer, port) {
  const profile = await mkdtemp(join(tmpdir(), `locust-drive-background-${answer}-`))
  const drive = await startDrive({
    name: `background-${answer}-${tag}`,
    port,
    workspace: await scratchRepository(`locust-background-${answer}-ws-`),
    profilePath: profile,
    outPath: join(OUT, answer),
    launchElsewhere: true,
    env: { LOCUST_CLOSE_ANSWER: answer },
    ...(packaged === undefined ? {} : { packaged }),
    seed
  })
  return { drive, profile }
}

// 1. Keep working in the background.
{
  const { drive, profile } = await launch('background', 9701)
  try {
    await drive.ready()
    await drive.resize(1200, 800)
    say(String(await drive.evaluate(openTeammateScript('Sable'))))
    check('Sable is counting', String(await startCounting(drive)) === 'running')
    await drive.capture('Sable counting, before the close', () => drive.evaluate('document.visibilityState'))
    // CHANGELOG 0.397.0: "Close the window, keep the work going." ready() emulates focus for
    // foreground drives; that also forces visibilityState to "visible" after a real native hide.
    // Restore native visibility before testing what Close actually did.
    await drive.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    void drive.evaluate('window.desktop.close()').catch(() => undefined)
    await sleep(2500)
    check('Locust is still up after the close', await answers(drive))
    check('and its window is hidden, not closed', String(await drive.evaluate('document.visibilityState')) === 'hidden')
    const ledger = createFileMissionLedger({ rootDirectory: join(profile, 'mission-ledger') })
    let phase = 'unknown'
    for (let i = 0; i < 180 && phase !== 'completed'; i += 1) {
      await sleep(1000)
      phase = (await ledger.listMissions()).missions[0]?.phase ?? 'none'
    }
    check('Sable’s run finished while the window was closed', phase === 'completed', phase)
    check('and Locust is still up, in the tray', await answers(drive))
  } catch (error) {
    failures += 1
    say(`background launch failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Close answered "Keep working in the background" (LOCUST_CLOSE_ANSWER=background).` }).catch(() => undefined)
  }
}

// 2. The control: Cancel leaves the window open.
{
  const { drive } = await launch('cancel', 9703)
  try {
    await drive.ready()
    await drive.resize(1200, 800)
    say(String(await drive.evaluate(openTeammateScript('Sable'))))
    check('control: Sable is counting', String(await startCounting(drive)) === 'running')
    await drive.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    void drive.evaluate('window.desktop.close()').catch(() => undefined)
    await sleep(2500)
    check('control: Cancel leaves the window open and visible', (await answers(drive)) && String(await drive.evaluate('document.visibilityState')) === 'visible')
  } catch (error) {
    failures += 1
    say(`control launch failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'The control: Close answered "Cancel".' }).catch(() => undefined)
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
