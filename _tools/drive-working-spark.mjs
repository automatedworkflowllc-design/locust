// A working conversation wears the spark in the sidebar (0.392).
//
//   node _tools/drive-working-spark.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-27: "better ideas for a 'working/busy' icon for sidebar, i
// think the one i suggested is getting outdated". Free model, spends nothing:
// Sable counts for a while, and while she works the drive reads the row's
// mark frame by frame -- the glyph the pseudo-element is drawing -- and keeps
// captures; when she finishes, the spark must be gone, the quiet dot back,
// and the title exactly where it was.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, conversationRows, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('working-spark-2026-09-27'), `working-spark-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-working-spark-ws-')
const drive = await startDrive({
  name: `working-spark-${tag}`,
  port: 9695,
  workspace,
  outPath: OUT,
  launchElsewhere: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const row = `document.querySelector('.lc-conv')`
const titleX = async () => Number(await drive.evaluate(`Math.round(${row}?.querySelector('.lc-conv__title')?.getBoundingClientRect().x ?? -1)`))

try {
  await drive.ready()
  await drive.resize(1440, 900)
  say(String(await drive.evaluate(openTeammateScript('Sable'))))
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Count from 1 to 150, one number per line, and nothing else. Do not use any tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const send = document.querySelector('button[aria-label="Send"]')
      if (send && !send.disabled) { send.click(); return }
    }
  })()`)
  const running = await drive.capture('while Sable works: the row wears the spark', async () => {
    for (let i = 0; i < 120; i += 1) {
      if (String(await drive.evaluate(`String(${row}?.querySelector('.lc-spark') !== null)`)) === 'true') break
      await sleep(250)
    }
    // Frame by frame: what the pseudo-element is drawing, every 40 ms for 2 s.
    return drive.evaluate(`(async () => {
      // Found afresh every time: the row is re-rendered as the run streams,
      // and a held reference goes stale (the first run read a detached node).
      const current = () => ${row}?.querySelector('.lc-spark')
      if (!current()) return JSON.stringify({ spark: false })
      const seen = []
      for (let i = 0; i < 50; i += 1) {
        const now = current()
        if (now) seen.push(getComputedStyle(now, '::before').content.replace(/"/g, '').replace('\\uFE0E', ''))
        await new Promise((r) => setTimeout(r, 40))
      }
      const spark = current()
      const style = getComputedStyle(spark, '::before')
      const box = spark.getBoundingClientRect()
      return JSON.stringify({ spark: true, seen, color: style.color, font: style.fontFamily, size: style.fontSize, box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], data: spark.getAttribute('data-orb') })
    })()`)
  })
  const seen = JSON.parse(String(running))
  const distinct = [...new Set(seen.seen ?? [])]
  check('the row wears the spark while the run works', seen.spark === true, JSON.stringify(seen.box))
  check('it turns through Claude Code\'s glyphs', distinct.length >= 5 && distinct.every((glyph) => ['·', '✢', '✳', '✶', '✻', '✽'].includes(glyph)), distinct.join(' '))
  // Monochrome since 0.429 (Colin, 2026-09-28: it was the one coloured thing in the sidebar): the text's own colour.
  check('in the text colour, not a hue', seen.color === 'rgb(242, 239, 233)', seen.color)
  check('drives still know the row is working', String(await drive.evaluate(`String(${conversationRows()}[0]?.running)`)) === 'true')
  const during = await titleX()
  for (let i = 0; i < 20; i += 1) {
    // Close-ups for the eye, a quarter second apart: the glyph changes.
    await drive.capture(`close-up ${String(i + 1)}`, async () => { await sleep(90); return 'frame' })
    if (i >= 3) break
  }
  await drive.capture('Sable finishes: the spark goes, the quiet dot comes back', async () => {
    for (let i = 0; i < 480; i += 1) {
      await sleep(500)
      if (String(await drive.evaluate(`String(${row}?.querySelector('.lc-spark') === null)`)) === 'true') break
    }
    return drive.evaluate(`${row}?.innerText.replace(/\\s+/g, ' ') ?? ''`)
  })
  const done = await drive.evaluate(`JSON.stringify({ spark: ${row}?.querySelector('.lc-spark') !== null, dot: ${row}?.querySelector('.lc-dot') !== null })`)
  const after = JSON.parse(String(done))
  check('finished: no spark, the dot back', !after.spark && after.dot, String(done))
  const finishedX = await titleX()
  check('the title never moved', during === finishedX && during > 0, `${String(during)} -> ${String(finishedX)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Sable on a free OpenCode model, counting to 150.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
