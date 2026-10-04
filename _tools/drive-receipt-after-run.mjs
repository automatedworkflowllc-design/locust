// Does the Receipt tab have the receipt right after a run finishes?
//
//   node _tools/drive-receipt-after-run.mjs [--packaged <Locust.exe>] [--label name]
//
// The 0.255 and 0.268 design reviews both found it a dead end: a run finished
// on screen, and its Receipt tab said "the durable receipt appears once this
// mission has been recovered from the ledger" with nothing to press. One short
// message on the free OpenCode route, then the tab is read back.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const label = arg('--label') ?? (packaged === undefined ? 'after' : 'before')

const workspace = await scratchRepository('locust-drive-receipt-ws-')
const drive = await startDrive({
  name: `receipt-after-run-${label}`,
  port: 9381,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const chip = () => drive.evaluate(`(() => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  return control ? control.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`)

try {
  await drive.capture('free route', async () => {
    await drive.ready()
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })
  const route = await chip()
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)

  await drive.capture('send one line and let it finish', () =>
    drive.evaluate(sendAndWaitScript('Reply with the single word OK. Do not use any tools.', { waitSeconds: 180 })))

  await drive.capture('open Activity, then the Receipt tab', () => drive.evaluate(`(async () => {
    const activity = [...document.querySelectorAll('button')].find((b) => /^\\s*Activity\\s*$/.test(b.innerText))
    if (!document.querySelector('.lc-inspector')) activity?.click()
    await new Promise((r) => setTimeout(r, 600))
    const tab = [...document.querySelectorAll('.lc-inspector button, .lc-inspector [role="tab"]')].find((b) => b.innerText.trim() === 'Receipt')
    if (!tab) return 'no Receipt tab'
    tab.click()
    await new Promise((r) => setTimeout(r, 900))
    const body = document.querySelector('.lc-inspector')
    return body ? body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400) : 'no inspector'
  })()`))
  await sleep(300)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Receipt after a run, ${label}. One free OpenCode message.` })
}
