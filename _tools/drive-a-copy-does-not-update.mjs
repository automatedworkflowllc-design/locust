// A copy of Locust that is not the installed one never updates itself (0.507).
//
//   node _tools/drive-a-copy-does-not-update.mjs --packaged <a win-unpacked Locust.exe> [--tag <name>]
//
// 2026-09-30: every copy shares one update cache, and a tester's copy that
// quit with an update pending ran the installer -- which closes the Locust in
// the installed folder: Colin's own, twice, mid-run. A copy has no
// `Uninstall Locust.exe` beside it. Its Settings must say it cannot update
// itself, with Check now disabled. Sends nothing.

import { join } from 'node:path'
import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-copy-update-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `copy-does-not-update-${tag}`,
  port: 9813,
  workspace,
  sendsNothing: true,
  outPath: join(recordRoot('copy-does-not-update-2026-09-30'), tag),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 240)}`}`)
}
try {
  await drive.capture('launch', () => drive.ready())
  const seen = JSON.parse(String(await drive.capture('Settings > General: Updates', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')?.click()
    await new Promise((r) => setTimeout(r, 900))
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => /General/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 900))
    // The host's answer about updating arrives after the page draws: wait for it, up to 10 s.
    for (let i = 0; i < 60 && !/cannot update itself|Up to date|is downloaded|Checking/.test(document.body.innerText); i += 1) await new Promise((r) => setTimeout(r, 250))
    const check = [...document.querySelectorAll('button')].find((b) => /Check now/.test(b.innerText))
    const all = document.body.innerText.replace(/\\s+/g, ' ')
    const at = all.search(/Updates/)
    return JSON.stringify({ text: at < 0 ? all.slice(0, 600) : all.slice(at, at + 400), checkDisabled: check?.disabled ?? null, checkTitle: check?.getAttribute('title') ?? null })
  })()`))))
  check('a copy says it cannot update itself', /This build cannot update itself/.test(seen.text), seen.text)
  check('and Check now is disabled', seen.checkDisabled === true, String(seen.checkDisabled))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A copy, not the installed Locust.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
