// Settings > Privacy & data says every connection Locust itself makes, and links the list (0.618, the PRD's R22).
//
//   node _tools/drive-every-connection-listed.mjs [--packaged <exe>] [--tag <name>]
//
// Reads the Network line and finds "Every connection, listed" -- not pressed:
// it opens the person's own browser. Nothing is sent.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-network-ws-')
const drive = await startDrive({
  name: `every-connection-listed-${tag}`, port: 9798, workspace, sendsNothing: true, outPath: join(recordRoot('every-connection-listed-2026-10-04'), tag), ...(packaged === undefined ? {} : { packaged }),
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
  await drive.resize(1200, 720)
  const network = await drive.capture('Settings > Privacy & data, the Network line', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')?.click()
    await new Promise((r) => setTimeout(r, 700))
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => /Privacy/.test(b.innerText))?.click()
    // Case-blind: the receipt's labels are drawn in capitals, and innerText reads them so.
    for (let i = 0; i < 40 && ![...document.querySelectorAll('dt')].some((dt) => /^network$/i.test(dt.innerText.trim())); i += 1) await new Promise((r) => setTimeout(r, 250))
    const dt = [...document.querySelectorAll('dt')].find((d) => /^network$/i.test(d.innerText.trim()))
    dt?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 300))
    const dd = dt?.nextElementSibling
    const link = dd?.querySelector('button.lc-linkbutton')
    return { text: dd?.innerText.replace(/\\s+/g, ' ').trim() ?? '', link: link?.innerText.trim() ?? null, clipped: dd ? dd.scrollWidth > dd.clientWidth + 1 : null }
  })()`))
  check('the Network line names the updates, the agents Locust installs, the pet gallery and the agents\' own services',
    ['checks for and downloads its own updates', 'installs the AI agents you ask it to', 'keeps Codex CLI and Copilot CLI current', 'reads the pet gallery when you open it', 'each AI agent talks to its own service'].every((words) => network.text.toLowerCase().includes(words.toLowerCase())), network.text)
  check('it links every connection, listed, and nothing is cut off', network.link === 'Every connection, listed' && network.clipped === false, JSON.stringify(network))
  check('no renderer errors, beyond Electron\'s launch line', drive.record.flatMap((entry) => entry.errors.map(String)).filter((line) => !/^Electron sandboxed_renderer\.bundle\.js script failed to run|^console\.error$/.test(line.trim())).length === 0)
  await sleep(100)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Settings > Privacy & data, the Network line.`, extra: `Checks failed: ${String(failures)}` })
  say(failures === 0 ? 'EVERY CONNECTION LISTED: PASSED' : `EVERY CONNECTION LISTED: FAILED (${String(failures)})`)
  process.exitCode = failures === 0 ? 0 : 1
}
