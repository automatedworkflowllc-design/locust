// Settings > AI agents: the Remote Control switch reads as one switch (0.619).
//
//   node _tools/drive-remote-control-reads-as-one-switch.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-04, of 0.618's screen: "whats going on here? ive never
// noticed this". The switch's state sentence ("Off. Enabling this lasts
// until...") had a row of its own under it, in the label's colour, and read
// as a second setting. Now it is the first words of the switch's own line, as
// on every other switch, and nothing sits under the switch while it is off.
// The switch is only looked at, never pressed: on, it runs Claude Code's
// Remote Control with the person's own account.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-remote-switch-ws-')
const drive = await startDrive({
  name: `remote-control-switch-${tag}`, port: 9799, workspace, sendsNothing: true, outPath: join(recordRoot('remote-control-reads-as-one-switch-2026-10-04'), tag), ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 600)}`}`)
}
try {
  await drive.ready()
  await drive.send('Page.bringToFront')
  // Opened at 1200 wide: at 1000 the sidebar is an icon rail, with no "Settings" to read.
  for (const [width, height] of [[1200, 720], [1000, 680]]) {
    await drive.resize(width, height)
    const seen = await drive.capture(`AI agents at ${String(width)}x${String(height)}`, () => drive.evaluate(`(async () => {
      if (!document.querySelector('.lc-settings__navitem')) {
        ;[...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')?.click()
        await new Promise((r) => setTimeout(r, 700))
      }
      ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => /AI agents/.test(b.innerText))?.click()
      // By its label's words, compared here: the app names it from a constant (REMOTE_CONTROL_LABEL).
      const find = () => [...document.querySelectorAll('[role=switch]')].find((b) => /^Let me start sessions on this computer from claude\\.ai$/.test(b.getAttribute('aria-label') ?? ''))
      for (let i = 0; i < 40 && !find(); i += 1) await new Promise((r) => setTimeout(r, 250))
      const toggle = find()
      toggle?.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 1500))
      const rows = toggle?.closest('.lc-settingrows')
      const row = toggle?.closest('.lc-settingrow')
      return {
        rows: rows?.querySelectorAll(':scope > .lc-settingrow').length ?? -1,
        status: row?.querySelector('[role=status]')?.innerText.trim() ?? null,
        note: row?.querySelector('.lc-settings__lede')?.innerText.trim() ?? null,
        on: toggle?.getAttribute('aria-checked'),
        sideways: document.documentElement.scrollWidth > innerWidth + 1
      }
    })()`))
    check(`${String(width)}x${String(height)}: one row, its line opening "Off.", the account note under it, the switch off, no sideways scroll`,
      seen.rows === 1 && /^Off\. When on, you can start Claude Code sessions in this folder from claude\.ai/.test(String(seen.status)) && /API keys do not work/.test(String(seen.note)) && seen.on === 'false' && seen.sideways === false, JSON.stringify(seen))
  }
  check('no renderer errors, beyond Electron\'s launch line', drive.record.flatMap((entry) => entry.errors.map(String)).filter((line) => !/^Electron sandboxed_renderer\.bundle\.js script failed to run|^console\.error$/.test(line.trim())).length === 0)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Settings > AI agents, the Remote Control switch, looked at and not pressed.`, extra: `Checks failed: ${String(failures)}` })
  say(failures === 0 ? 'REMOTE CONTROL READS AS ONE SWITCH: PASSED' : `REMOTE CONTROL READS AS ONE SWITCH: FAILED (${String(failures)})`)
  process.exitCode = failures === 0 ? 0 : 1
}
