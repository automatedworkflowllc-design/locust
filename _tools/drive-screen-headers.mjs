// Do the list screens' headers agree, and does the content below them move?
//
//   node _tools/drive-screen-headers.mjs
//
// Colin on the Routines header: "why am I so triggered". The design brief of
// 2026-09-21 says the cause is that Routines renders a DIFFERENT header
// component from every other screen -- `.lc-screen__head`, a flex column,
// against `.lc-screen__header`, a 60px row -- so everything below the title
// steps down when you land on Routines and back up when you leave. A tab
// click is the most frequent gesture in the app.
//
// This measures it rather than arguing it: the header box on each screen, and
// where the first thing under it actually starts. Run it before a change and
// after one; the numbers are the claim.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

/*
 * The packaged build by default, because that is what anybody installs --
 * but `LOCUST_DRIVE_LOCAL=1` drives `out/` instead.
 *
 * Without that switch this measured the LAST RELEASE while I was iterating
 * on the change, and reported the old numbers back as if they were the new
 * ones. A drive that silently measures a different binary from the one you
 * just built is the stale-build trap wearing a drive's clothes.
 */
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const local = process.env.LOCUST_DRIVE_LOCAL === '1'
const packaged = local || !existsSync(EXE) ? undefined : EXE
say(packaged === undefined ? 'driving the LOCAL build in out/' : `driving the PACKAGED build: ${EXE}`)

const workspace = await scratchRepository('locust-drive-headers-ws-')
const drive = await startDrive({
  name: 'screen-headers',
  port: 9321,
  ...(packaged === undefined ? {} : { packaged }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

/** Open a screen by the sidebar control that names it. */
const open = (label) => `(async () => {
  const button = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? '').startsWith(${JSON.stringify(label)}) || b.innerText.trim() === ${JSON.stringify(label)})
  if (!button) return 'NO CONTROL for ${label}; titles: ' + [...document.querySelectorAll('button')].map(b => b.getAttribute('title') ?? b.innerText.trim()).filter(Boolean).join(' / ').slice(0, 300)
  button.click()
  await new Promise(r => setTimeout(r, 900))
  return 'opened'
})()`

/**
 * The header box, and where the content under it starts.
 *
 * Both halves matter. The header's own height is the visible difference; the
 * top of the first thing below it is what the eye tracks across a tab click,
 * and it is the number the complaint is actually about.
 */
const measure = `(() => {
  const header = document.querySelector('.lc-screen__header, .lc-screen__head')
  if (!header) return 'NO HEADER on this screen'
  const box = header.getBoundingClientRect()
  const title = header.querySelector('.lc-screen__title')?.getBoundingClientRect()
  // The first element after the header that draws anything.
  const screen = header.parentElement
  const after = [...(screen?.children ?? [])].filter(n => n !== header)
    .map(n => n.getBoundingClientRect()).filter(r => r.height > 0)[0]
  return JSON.stringify({
    component: header.className.includes('lc-screen__header') ? 'row (.lc-screen__header)' : 'column (.lc-screen__head)',
    headerHeight: Math.round(box.height),
    titleCentreFromTop: title === undefined ? null : Math.round(title.top + title.height / 2 - box.top),
    contentStartsAt: after === undefined ? null : Math.round(after.top)
  })
})()`

const seen = {}
const look = async (label) => {
  await drive.capture(`${label}: header and content`, async () => {
    const opened = await drive.evaluate(open(label))
    if (String(opened).startsWith('NO CONTROL')) return String(opened)
    const text = await drive.evaluate(measure)
    if (String(text).startsWith('NO HEADER')) return String(text)
    seen[label] = JSON.parse(String(text))
    const row = seen[label]
    return `${row.component} · header ${String(row.headerHeight)}px · title centre ${String(row.titleCentreFromTop)}px · content starts at y=${String(row.contentStartsAt)}`
  })
}

try {
  await drive.capture('launch', () => drive.ready())
  await look('Missions')
  await look('Rooms')
  await look('Routines')

  await drive.capture('THE STEP: what moves when you change tab', () => {
    const rows = Object.entries(seen)
    if (rows.length < 2) return 'not enough screens measured to compare'
    const heights = rows.map(([name, row]) => `${name} ${String(row.headerHeight)}px`)
    const starts = rows.map(([name, row]) => `${name} y=${String(row.contentStartsAt)}`)
    const tops = rows.map(([, row]) => row.contentStartsAt).filter((value) => value !== null)
    const step = tops.length < 2 ? null : Math.max(...tops) - Math.min(...tops)
    return `headers: ${heights.join(' · ')} || content starts: ${starts.join(' · ')} || WORST STEP BETWEEN TABS: ${step === null ? 'unknown' : `${String(step)}px`}`
  })
} finally {
  await drive.finish({
    intro: 'Header height and first-content position on Missions, Rooms and Routines. The number that matters is the last one: how far the content under the title jumps when you change tab.'
  })
  say(`kept: ${drive.out}`)
}
