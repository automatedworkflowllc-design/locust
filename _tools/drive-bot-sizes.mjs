// Every bot surface at its 0.561 size (botSizes.ts), measured: drawn at the
// size the table says, and nothing it sits in pushed out of shape -- the
// sidebar's strip of faces (five teammates: five faces and no count; eight:
// four and "+4"), the Team screen's cards, the workroom header, the collapsed
// rail, and the conversation list's marks.
//
//   node _tools/drive-bot-sizes.mjs [--packaged <exe>]
//
// Colin, 2026-10-03: "we might have to make them a little bigger now that i
// keep having you add these assets ... some may have to be bigger than
// others". A bigger face in a box sized for the old one is the failure to
// catch: the strip measured 267 of 267 px at the old size (Sidebar.tsx).
// Costs nothing: no run is started.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = packaged === undefined ? 'local' : 'packaged'
const OUT = join(recordRoot('bot-sizes-2026-10-03'), tag)
await mkdir(OUT, { recursive: true })

// The sizes the app means to draw, read from the table itself, so the drive cannot drift from it.
const table = await readFile(new URL('../apps/desktop/src/renderer/src/botSizes.ts', import.meta.url), 'utf8')
const SIZE = Object.fromEntries([...table.matchAll(/^\s+(\w+): (\d+),?$/gm)].map((m) => [m[1], Number(m[2])]))

const mate = (n, name, hue, shape) => ({
  teammateId: `tm_${name.toLowerCase()}${'0'.repeat(23 - name.length)}${n}`,
  name,
  hue,
  role: 'Code & Migrations',
  avatar: { headwear: n % 6, accessory: n % 3, mouth: n % 4, ...(shape === undefined ? {} : { bot: { shape, face: 'eyes' } }) },
  createdAt: '2026-10-03T08:00:00.000Z'
})
const EIGHT = [
  mate(1, 'Wren', 'lime'),
  mate(2, 'Atlas', 'blue', 'droid'),
  mate(3, 'Sable', 'pearl', 'ghost'),
  mate(4, 'Gem', 'teal'),
  mate(5, 'Pip', 'butter', 'prompt'),
  mate(6, 'Juno', 'rose'),
  mate(7, 'Moss', 'slate'),
  mate(8, 'Ivo', 'violet', 'hopper')
]

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// A container's overflow and its bots, measured in the page.
const measure = (container, bots = '.lc-bot[data-bot]') => `(() => {
  const box = document.querySelector(${JSON.stringify(container)})
  if (!box) return JSON.stringify({ missing: true })
  const r = box.getBoundingClientRect()
  const faces = [...box.querySelectorAll(${JSON.stringify(bots)})].map((b) => {
    const f = b.getBoundingClientRect()
    return { w: Math.round(f.width), h: Math.round(f.height), inside: f.left >= r.left - 1 && f.right <= r.right + 1 && f.top >= r.top - 1 && f.bottom <= r.bottom + 1 }
  })
  return JSON.stringify({ overflowX: box.scrollWidth - box.clientWidth, overflowY: box.scrollHeight - box.clientHeight, width: Math.round(r.width), height: Math.round(r.height), faces })
})()`
const strip = `(() => {
  const row = document.querySelector('.lc-faces')
  if (!row) return JSON.stringify({ missing: true })
  const r = row.getBoundingClientRect()
  // Room is measured to the CONTENT edge: a pill pressed into the row's padding fits only by eating its margin.
  const contentRight = r.right - parseFloat(getComputedStyle(row).paddingRight)
  const kids = [...row.children].map((c) => c.getBoundingClientRect())
  const overlaps = kids.some((a, i) => kids.some((b, j) => j > i && a.right > b.left + 0.5 && b.right > a.left + 0.5 && a.bottom > b.top && b.bottom > a.top))
  const lastRight = Math.max(...kids.map((k) => k.right))
  const tops = new Set(kids.map((k) => Math.round(k.top + k.height / 2)))
  return JSON.stringify({
    faces: row.querySelectorAll('.lc-faces__one').length,
    face: Math.round(row.querySelector('.lc-faces__one .lc-bot')?.getBoundingClientRect().width ?? 0),
    count: (row.textContent.match(/\\+(\\d+)/) ?? [])[1] ?? '',
    room: Math.round(contentRight - lastRight),
    overflowX: row.scrollWidth - row.clientWidth,
    oneLine: tops.size <= 2 && Math.max(...kids.map((k) => k.bottom)) - Math.min(...kids.map((k) => k.top)) < 48,
    overlaps
  })
})()`
const click = (text) => `(async () => {
  const el = [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim() === ${JSON.stringify(text)})
  el?.click()
  await new Promise((r) => setTimeout(r, 1100))
  return el ? 'clicked' : 'none'
})()`

// A conversation written straight into the profile's ledger: no run, nothing sent (as drive-mission-counts does).
async function seedConversation(profile, id, prompt, at) {
  await mkdir(join(profile, 'mission-ledger'), { recursive: true })
  const metadata = { missionId: id, runId: `run_${id}`, prompt, runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: '0.153.0', workspaceId: 'ws_bot_sizes', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at }
  await writeFile(join(profile, 'mission-ledger', `${id}.jsonl`), `${JSON.stringify({ schemaVersion: 7, recordType: 'mission.created', ledgerSequence: 1, occurredAt: at, metadata })}\n`, 'utf8')
}

async function launch(name, teammates, steps, missionOwners = {}) {
  const workspace = await scratchRepository(`locust-drive-bot-sizes-${name}-`)
  const profilePath = await mkdtemp(join(tmpdir(), `locust-drive-bot-sizes-${name}-`))
  let minute = 0
  for (const id of Object.keys(missionOwners)) {
    minute += 1
    await seedConversation(profilePath, id, `Seeded conversation ${id}`, `2026-10-03T08:${String(minute).padStart(2, '0')}:00.000Z`)
  }
  const owners = Object.fromEntries(Object.entries(missionOwners).filter(([, owner]) => owner !== null))
  const drive = await startDrive({
    name: `bot-sizes-${name}-${tag}`,
    port: 9883,
    workspace,
    profilePath,
    outPath: join(OUT, name),
    sendsNothing: true,
    ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates, missionOwners: owners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, layout: 'full' } }
  })
  try {
    await drive.ready()
    await drive.resize(1440, 900)
    await sleep(1800)
    await steps(drive)
  } catch (error) {
    failures += 1
    say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No run. ${teammates.length} teammates; bots measured at their botSizes.ts sizes.`, extra: `Checks failed so far: ${String(failures)}` })
  }
}

await launch('five', EIGHT.slice(0, 5), async (drive) => {
  const s = JSON.parse(String(await drive.capture('Five teammates: the strip', () => drive.evaluate(strip))))
  check(`five teammates: five faces at ${SIZE.sidebarFaces}px, no count, on one line, nothing overlapping or spilling`, s.faces === 5 && s.face === SIZE.sidebarFaces && s.count === '' && s.oneLine && !s.overlaps && s.overflowX <= 0 && s.room >= 0, JSON.stringify(s))
})

await launch('eight', EIGHT, async (drive) => {
  const s = JSON.parse(String(await drive.capture('Eight teammates: the strip', () => drive.evaluate(strip))))
  check(`eight teammates: four faces at ${SIZE.sidebarFaces}px and "+4", on one line, nothing overlapping or spilling`, s.faces === 4 && s.face === SIZE.sidebarFaces && s.count === '4' && s.oneLine && !s.overlaps && s.overflowX <= 0 && s.room >= 0, JSON.stringify(s))

  await drive.evaluate(click('Team'))
  const cards = JSON.parse(String(await drive.capture('The Team screen', () => drive.evaluate(`(() => JSON.stringify([...document.querySelectorAll('.lc-rostercard')].map((card) => {
    const bot = card.querySelector('.lc-rostercard__head .lc-bot')?.getBoundingClientRect()
    const name = card.querySelector('.lc-rostercard__name')
    return { face: Math.round(bot?.width ?? 0), spill: card.scrollWidth - card.clientWidth, nameCut: name ? name.scrollWidth > name.clientWidth + 1 : null }
  })))()`))))
  // The "New teammate" card shares the card's look and has no face.
  const faced = cards.filter((c) => c.face > 0)
  check(`every teammate's Team card face is ${SIZE.rosterCard}px and no card spills`, faced.length === 8 && faced.every((c) => c.face === SIZE.rosterCard) && cards.every((c) => c.spill <= 0), JSON.stringify(cards))
  check('no teammate name is cut short on its card', cards.every((c) => c.nameCut !== true), JSON.stringify(cards.map((c) => c.nameCut)))

  // The conversation list: Wren's row wears her face, the other its model's mark, and both titles start at one x.
  await drive.evaluate(click('Conversations'))
  const rows = JSON.parse(String(await drive.capture('The conversation list', () => drive.evaluate(`(() => JSON.stringify([...document.querySelectorAll('.lc-conv')].map((row) => ({
    face: Math.round(row.querySelector('.lc-bot')?.getBoundingClientRect().width ?? 0),
    mark: Math.round(row.querySelector('.lc-conv__runtime, .lc-conv__nobody')?.getBoundingClientRect().width ?? 0),
    title: Math.round((row.querySelector('.lc-conv__title')?.getBoundingClientRect().left ?? 0) * 10) / 10,
    height: Math.round(row.getBoundingClientRect().height)
  }))))()`))))
  const titles = new Set(rows.map((r) => r.title))
  check(`the conversation list: an owner's face at ${SIZE.conversationOwner}px, a model's mark in the same footprint, titles at one x, rows one height`, rows.length >= 2 && rows.some((r) => r.face === SIZE.conversationOwner) && rows.some((r) => r.face === 0 && r.mark > 0) && titles.size === 1 && new Set(rows.map((r) => r.height)).size === 1, JSON.stringify(rows))

  // A teammate's conversation: its face in the header, the header the height it was.
  await drive.evaluate(`(async () => { [...document.querySelectorAll('.lc-conv')].find((row) => row.querySelector('.lc-bot'))?.click(); await new Promise((r) => setTimeout(r, 1600)); return 'ok' })()`)
  const head = JSON.parse(String(await drive.capture("A teammate's workroom: the header", () => drive.evaluate(measure('.lc-workroom__header')))))
  check(`the conversation header's face is ${SIZE.workroomHeader}px, inside the header, which does not grow or spill`, !head.missing && head.faces.length >= 1 && head.faces[0].w === SIZE.workroomHeader && head.faces[0].inside && head.overflowY <= 0 && head.height <= 72, JSON.stringify(head))

  // The rail: the sidebar collapsed.
  await drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    const nav = [...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('Appearance'))
    nav?.click()
    await new Promise((r) => setTimeout(r, 700))
    const rail = [...document.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'Rail')
    rail?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return rail ? 'rail' : 'no rail button'
  })()`)
  const rail = JSON.parse(String(await drive.capture('The rail', () => drive.evaluate(`(() => {
    const side = document.querySelector('.lc-sidebar')
    if (!side) return JSON.stringify({ missing: true })
    const r = side.getBoundingClientRect()
    const faces = [...side.querySelectorAll('.lc-bot[data-bot]')].map((b) => b.getBoundingClientRect())
    return JSON.stringify({ compact: document.querySelector('.lc-shell.is-compact') !== null, width: Math.round(r.width), faces: faces.map((f) => Math.round(f.width)), inside: faces.every((f) => f.left >= r.left - 1 && f.right <= r.right + 1), spill: side.scrollWidth - side.clientWidth })
  })()`))))
  check(`the rail's faces are ${SIZE.railRow}px and sit inside it`, rail.compact && rail.faces.length >= 4 && rail.faces.every((w) => w === SIZE.railRow) && rail.inside && rail.spill <= 0, JSON.stringify(rail))
}, { conv_bot_sizes_wren: EIGHT[0].teammateId, conv_bot_sizes_codex: null })

say(failures === 0 ? 'BOT SIZES PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
