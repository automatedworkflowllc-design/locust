// A sign-in done OUTSIDE Locust shows when you come back to the window (10/02).
//
//   node _tools/drive-sign-in-elsewhere.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: signed Codex in, "its not updating ur screen". Here Codex
// starts signed out (CODEX_HOME is an EMPTY temp folder, so nothing of
// ~/.codex is read or changed), Settings > AI agents shows its row, and then
// Codex is signed in from outside the app -- `codex login --with-api-key`
// with a made-up key into that same temp folder (nothing is sent anywhere;
// `login status` only reads the file). Then the window loses and regains
// focus, as it does when the person comes back from a browser. The row must
// stop reading SIGN IN without a relaunch. Sends nothing.
//
// The focus is dispatched to the window (blur, then focus), which runs the
// same listener the OS focus does; it is not the OS handing focus back.

import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const codexHome = await mkdtemp(join(tmpdir(), 'locust-elsewhere-codex-'))
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `sign-in-elsewhere-${tag}`,
  port: 9863,
  workspace: await scratchRepository('locust-elsewhere-ws-'),
  sendsNothing: true,
  outPath: join(recordRoot('sign-in-elsewhere-2026-10-02'), tag),
  env: { CODEX_HOME: codexHome },
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-02T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const codexRow = async () => String(await drive.evaluate(`(() => {
  const row = [...document.querySelectorAll('.lc-runtimerow, .lc-runtimecell')].find((r) => /^\\s*Codex/i.test(r.innerText))
  return row ? row.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`))
try {
  await drive.ready()
  await drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const nav = [...document.querySelectorAll('.lc-settings__navitem')].find(n => n.innerText.trim().startsWith('AI agents'))
    if (nav) nav.click()
  })()`)
  let before = ''
  for (let i = 0; i < 40 && !/SIGN IN/.test(before); i += 1) {
    await sleep(500)
    before = await codexRow()
  }
  await drive.capture('Codex signed out', async () => before)
  check('Codex starts signed out', /SIGN IN/.test(before), before)
  // Past the window's own 15 s re-check and the 10 s gap, so only the return to the window can be what asks.
  await sleep(27_000)
  execFileSync('codex', ['login', '--with-api-key'], { input: 'sk-not-a-real-key\n', env: { ...process.env, CODEX_HOME: codexHome }, shell: true, stdio: ['pipe', 'ignore', 'ignore'] })
  await sleep(1_000)
  const untouched = await codexRow()
  check('signing in elsewhere changes nothing while the window is away', /SIGN IN/.test(untouched), untouched)
  await drive.evaluate(`window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'))`)
  let after = untouched
  let at
  for (let second = 0; second < 20; second += 1) {
    await sleep(1_000)
    after = await codexRow()
    if (!/SIGN IN/.test(after)) { at = second + 1; break }
  }
  await drive.capture('back in the window', async () => after)
  check('back in the window, the Codex row no longer reads SIGN IN', at !== undefined, `${after} (after ${String(at ?? 'more than 20')}s)`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Codex signed out in a temp home, signed in from outside, window refocused.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
