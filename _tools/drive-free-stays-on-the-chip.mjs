// "Free" stays on the route chip at every width (Boss's 0.483 review).
//
//   node _tools/drive-free-stays-on-the-chip.mjs [--packaged <exe>] [--tag <name>]
//
// Boss: at 1120 a long free model name was cut to "Muse Spark 1.3 Con..." and
// the word that says the route costs nothing went with it. "Free" has been a
// tag outside the part that truncates since 0.289; this measures it, on the
// longest free names OpenCode lists, at 1120, 1215 and 1440, with a teammate
// open and nothing running. Sends nothing.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODELS = ['opencode/muse-spark-1.3-contributor-free', 'opencode/nemotron-3-ultra-free']
const OUT = join(recordRoot('free-stays-on-the-chip-2026-09-30'), `free-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-free-chip-ws-')
const PROFILE = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-free-chip-profile-'))
const drive = await startDrive({
  name: `free-chip-${tag}`, port: 9795, workspace, profilePath: PROFILE, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: MODELS.map((model, index) => ({ teammateId: `tm_free_${String(index)}`, name: index === 0 ? 'Ash' : 'Birch', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-30T00:00:00.000Z', route: { runtime: 'opencode', model, mode: 'accept-edits' } })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const CHIP = `(() => {
  const free = document.querySelector('form.command-dock .lc-control__free')
  const chip = free?.closest('.lc-control')
  const model = chip?.querySelector('.lc-control__model')
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } }
  const row = [...document.querySelectorAll('form.command-dock .lc-control, form.command-dock .lc-send')]
    .filter((el) => el.offsetParent !== null && !el.closest('.lc-menu'))
    .map((el) => ({ label: (el.getAttribute('aria-label') ?? el.innerText).trim().slice(0, 30), box: el.getBoundingClientRect() }))
  const hits = []
  for (let i = 0; i < row.length; i += 1) for (let j = i + 1; j < row.length; j += 1) {
    const a = row[i].box, b = row[j].box
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(row[i].label + ' / ' + row[j].label)
  }
  return JSON.stringify({
    width: innerWidth,
    text: chip?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    free: box(free), chip: box(chip), model: box(model),
    modelCut: model ? model.scrollWidth > model.clientWidth + 1 : null,
    overlaps: hits
  })
})()`

try {
  await drive.ready()
  for (const [index, name] of ['Ash', 'Birch'].entries()) {
    for (const [w, h] of [[1120, 760], [1215, 800], [1440, 900]]) {
      await drive.resize(w, h)
      await drive.evaluate(`(async () => {
        const face = [...document.querySelectorAll('.lc-faces__one')].find((one) => (one.getAttribute('aria-label') ?? '').startsWith('${name} — '))
        face?.click()
        await new Promise((r) => setTimeout(r, 700))
      })()`)
      const seen = JSON.parse(String(await drive.capture(`${name} (${MODELS[index]}) at ${String(w)}`, () => drive.evaluate(CHIP))))
      const shown = seen.free !== null && seen.chip !== null && seen.free.width > 10 && seen.free.right <= seen.chip.right + 1 && seen.chip.right <= seen.width
      check(`${String(w)}, ${name}: "Free" is whole and inside the chip`, shown, JSON.stringify(seen))
      check(`${String(w)}, ${name}: nothing on the composer row sits on another`, seen.overlaps.length === 0, seen.overlaps.join('; '))
    }
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "\"Free\" on the route chip at 1120, 1215 and 1440, on the two longest free OpenCode names." })
}
say(failures === 0 ? 'FREE STAYS ON THE CHIP' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
