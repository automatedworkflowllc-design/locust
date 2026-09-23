// The harness's one way to open a teammate, checked against the app.
//
//   node _tools/drive-open-teammate.mjs [--packaged <exe>]
//
// Yurt's beta report, 2026-09-23: "most drives die on 'open the teammate'
// (the rail has no 'Message X' title any more)". 115 lookups across 107
// harnesses now go through `teammateFace` in drive-lib; this is that seam
// checked like a test. Seven teammates: the rail draws four of them and a +3
// (Sidebar.tsx: every face up to five, four and a count from six). The four
// must open from their faces; the other three from the Team screen's Message
// button, which did not exist until this drive looked for it -- a person
// with six teammates could not message the fifth. Each must end with the
// composer saying "Message <name>…", and a name nobody has must be reported
// rather than clicked past. Sends nothing.

import { openTeammateScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const NAMES = ['Wren', 'Atlas', 'Sol', 'Juniper', 'Vega', 'Onyx', 'Pike']
const HUES = ['lime', 'blue', 'violet', 'clay', 'lime', 'blue', 'violet']

const drive = await startDrive({
  name: 'open-teammate',
  port: 9413,
  workspace: await scratchRepository('locust-drive-open-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: NAMES.map((name, index) => ({
      teammateId: `tm_${name.toLowerCase()}`,
      name,
      hue: HUES[index],
      role: 'Code & Migrations',
      createdAt: `2026-09-05T05:0${String(index)}:00.000Z`
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  const faces = Number(await drive.evaluate(`document.querySelectorAll('.lc-faces__one').length`))
  say(`faces in the rail: ${String(faces)}`)
  check('the rail draws four faces for a team of seven', faces === 4, String(faces))
  for (const name of NAMES) {
    const inRail = await drive.evaluate(`Boolean(${teammateFace(name)})`)
    const said = await drive.evaluate(openTeammateScript(name))
    check(`${name} opens${inRail ? ' from the rail' : ' from the Team screen'}, and the composer is theirs`, said === `opened ${name}`, said)
  }
  // The expression the 107 harnesses use, on its own: it must find the face.
  const found = await drive.evaluate(`(${teammateFace('Atlas')})?.getAttribute('aria-label') ?? 'nothing'`)
  check('the lookup the harnesses share finds a face by name', found.startsWith('Atlas — '), found)
  const nobody = await drive.evaluate(openTeammateScript('Nobody'))
  check('a name nobody has is reported', nobody.startsWith('no face for Nobody'), nobody.slice(0, 80))
  await drive.capture('the Team screen: a Message button on every card', () => drive.evaluate(`(async () => {
    // The Team button toggles, and the failed lookup above leaves it open.
    if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
    await new Promise((r) => setTimeout(r, 600))
    return String(document.querySelectorAll('.lc-rostercard__message').length) + ' Message buttons on ' + String(document.querySelectorAll('.lc-rostercard').length) + ' cards'
  })()`))
  await drive.capture('the last teammate opened', () => drive.evaluate(openTeammateScript('Onyx')))
  say(failures === 0 ? '\nOPEN TEAMMATE PASSED' : `\nOPEN TEAMMATE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Seven seeded teammates, opened through the harness’s one lookup. Sends nothing.' })
}
