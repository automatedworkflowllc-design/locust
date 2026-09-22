// The first screen, with nobody on the roster yet.
//
//   LOCUST_DRIVE_LOCAL=1 node _tools/drive-welcome-look.mjs
//
// Colin, 2026-09-21: the text under the logo "is a bit messy... plus its way
// off center". Measures where the mark card's left edge is against the text
// under it, which is what "off centre" turns out to mean here: the card is
// centred at 480px inside a 640px column and the prose starts at the
// column's edge, so two left edges disagree by however wide the gap is.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, say, scratchRepository, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const local = process.env.LOCUST_DRIVE_LOCAL === '1'
const packaged = local || !existsSync(EXE) ? undefined : EXE
say(packaged === undefined ? 'driving the LOCAL build in out/' : 'driving the PACKAGED build')

const workspace = await scratchRepository('locust-drive-welcome-ws-')
const drive = await startDrive({
  name: 'welcome-look',
  port: 9324,
  ...(packaged === undefined ? {} : { packaged }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const edges = `(() => {
  const card = document.querySelector('.lc-markcard')
  const intro = document.querySelector('.lc-intro')
  const inner = document.querySelector('.lc-empty__inner')
  if (!card || !inner) return 'NO WELCOME SCREEN; body reads: ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)
  const box = (n) => { const r = n.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } }
  const c = box(card)
  const i = intro === null ? null : box(intro)
  return JSON.stringify({
    column: box(inner),
    markCard: c,
    intro: i,
    leftEdgesDisagreeBy: i === null ? null : Math.abs(c.left - i.left),
    introText: intro?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? '(no intro)'
  })
})()`

try {
  await drive.capture('launch, with nobody on the roster', () => drive.ready())
  await drive.capture('where the lockup sits against the words under it', () => drive.evaluate(edges))
} finally {
  await drive.finish({ intro: 'The first screen with an empty roster: where the mark card sits against the prose under it, and what that prose says.' })
  say(`kept: ${drive.out}`)
}
