// The SIGN IN row is a button, and pressing it opens the runtime's own sign-in.
//
//   node _tools/drive-sign-in-button.mjs
//
// Colin, 2026-09-22: signed in to Meta in the browser, Muse still read SIGN
// IN, and the row only said `run muse login`. This drives the real Settings
// row on a machine where Muse is installed and signed out, presses Sign in,
// and checks a console window running the runtime's sign-in actually
// started -- then closes it without anybody approving anything, so nothing
// is signed in by the drive.

import { execSync } from 'node:child_process'

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const RUNTIME = process.env.LOCUST_SIGN_IN_RUNTIME ?? 'muse'

/** Console windows whose command line is a sign-in -- the thing the button opens. */
function signInWindows() {
  const out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'cmd.exe\'\\" | Where-Object { $_.CommandLine -match \'/[k].*login\' } | ForEach-Object { $_.ProcessId }"',
    { encoding: 'utf8' }
  )
  return out.split(/\s+/).filter((id) => id.length > 0)
}

const before = new Set(signInWindows())
const workspace = await scratchRepository()
const drive = await startDrive({
  name: 'sign-in-button',
  port: 9294,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-22T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'auto' }
  }
})

const failures = []
try {
  await drive.capture('launch', () => drive.ready())
  const row = await drive.capture('Settings, the signed-out row', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const nav = [...document.querySelectorAll('.lc-settings__navitem')].find(n => n.innerText.trim().startsWith('AI agents'))
    if (nav) nav.click()
    await new Promise(r => setTimeout(r, 700))
    const rows = [...document.querySelectorAll('.lc-runtimerow, .lc-runtimecell')]
    const signedOut = rows.filter(r => /SIGN IN/.test(r.innerText))
    const button = signedOut.map(r => r.querySelector('button')).find(b => b && b.textContent.trim() === 'Sign in')
    if (button) button.scrollIntoView({ block: 'center' })
    return JSON.stringify({ signedOut: signedOut.map(r => r.innerText.replace(/\\s+/g, ' ').trim()), button: button ? button.title : null })
  })()`))
  const seen = JSON.parse(row)
  if (seen.signedOut.length === 0) failures.push('no runtime read SIGN IN, so there was nothing to press')
  if (seen.button === null) failures.push('a SIGN IN row had no Sign in button')

  const after = await drive.capture('pressed Sign in', () => drive.evaluate(`(async () => {
    const rows = [...document.querySelectorAll('.lc-runtimerow, .lc-runtimecell')].filter(r => /SIGN IN/.test(r.innerText))
    const row = rows.find(r => r.innerText.toLowerCase().includes(${JSON.stringify(RUNTIME)})) ?? rows[0]
    const button = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in')
    button.click()
    await new Promise(r => setTimeout(r, 1500))
    return row.innerText.replace(/\\s+/g, ' ').trim()
  })()`))
  if (!/Finish in the window/.test(after)) failures.push(`the row did not say where to finish: ${after}`)

  const opened = signInWindows().filter((id) => !before.has(id))
  if (opened.length === 0) failures.push('no sign-in console window was started')
  // Close what the drive opened, before anybody could approve it.
  for (const id of opened) {
    try { execSync(`taskkill /PID ${id} /T /F`, { stdio: 'ignore' }) } catch { /* already gone */ }
  }
  say(`sign-in windows opened and closed: ${String(opened.length)}`)
} finally {
  await drive.finish({ intro: 'Build: out/. Settings > Runtimes on this machine, the signed-out row, Sign in pressed; the window it opened was closed before anything was approved.' })
}

for (const failure of failures) say(`[FAIL] ${failure}`)
if (failures.length === 0) say('[PASS] SIGN IN is a button, and it opens the runtime\'s own sign-in')
process.exitCode = failures.length === 0 ? 0 : 1
