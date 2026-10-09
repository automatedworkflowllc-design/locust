// LOCUST_SPEND=1 node _tools/drive-images-in-the-thread.mjs [--tag before|after]
// Two Claude Code / Haiku 4.5 turns in Edit; no permission bypasses.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { openTeammateScript, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'after'
const workspace = await scratchRepository('locust-images-in-thread-')
function chunk(type, bytes) {
  const name = Buffer.from(type), payload = Buffer.concat([name, bytes]); let crc = 0xffffffff
  for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  const size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(bytes.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, payload, sum])
}
// A small real chart: three rising blue bars against a white background.
const width = 220, height = 120, pixels = Buffer.alloc((width * 4 + 1) * height)
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const at = y * (width * 4 + 1) + 1 + x * 4
  const bar = [35, 95, 155].findIndex(left => x >= left && x < left + 30)
  const blue = bar >= 0 && y >= 100 - [30, 55, 80][bar] && y < 100
  pixels.set(blue ? [40, 100, 210, 255] : [255, 255, 255, 255], at)
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
await writeFile(join(workspace, 'chart.png'), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]))
// Auto, in the drive's own scratch folder: the red square is written by a command, and a drive never
// answers an approval card itself (2026-10-05: it clicked "Approve once" on a matching card; Colin
// approved one by hand when the wording did not match). In Auto nothing asks.
const route = { runtime: 'claude', model: 'claude-haiku-4-5', mode: 'auto' }
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const drive = await startDrive({ name: `images-in-thread-${tag}`, port: 9919, workspace, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  outPath: join(recordRoot('images-in-the-thread-2026-10-05'), tag),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-10-05T00:00:00.000Z', route }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true } }
})
let failures = 0
const checks = []
function check(name, ok, detail) { const line = `[${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`; checks.push(line); say(line); if (!ok) failures++ }
function send(prompt) {
  return `(async () => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(prompt)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    document.querySelector('button[aria-label="Send"]')?.click()
    for (let i = 0; i < 480; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    for (const line of document.querySelectorAll('.lc-thread .lc-steps__line[aria-expanded="false"], .lc-thread .lc-activity[aria-expanded="false"]')) line.click()
    await new Promise(r => setTimeout(r, 1500))
    return document.querySelector('.lc-thread')?.innerText.slice(-1200) ?? 'no thread'
  })()`
}
try {
  await drive.capture('Ash on Claude Code Haiku 4.5 in Auto', async () => { await drive.ready(); return drive.evaluate(openTeammateScript('Ash')) })
  const shownRoute = await drive.evaluate(`document.querySelector('form.command-dock')?.innerText`)
  say(`route shown: ${shownRoute}`)
  await drive.capture('Read chart.png and describe the chart', () => drive.evaluate(send('Read chart.png and tell me in one sentence what it shows.')))
  const read = await drive.evaluate(`(() => {
    const img = [...document.querySelectorAll('.lc-thread .lc-threadimage__picture')].find(img => img.alt.endsWith('chart.png'))
    const box = img?.getBoundingClientRect(); const row = [...document.querySelectorAll('.lc-thread .lc-filerow')].find(row => row.textContent.includes('chart.png') && /Read/.test(row.textContent))
    return { readRow: !!row, named: row?.textContent, painted: !!img && img.complete && img.naturalWidth > 0, width: box?.width, height: box?.height, natural: img ? [img.naturalWidth, img.naturalHeight] : [], columnWidth: img?.closest('.lc-agentline__body')?.getBoundingClientRect().width }
  })()`)
  check('Read row keeps the chart name and draws the chart', read.readRow && read.painted, JSON.stringify(read))
  check('chart keeps its proportions within the reply width and 320px height', read.painted && read.height <= 320 && read.width <= read.columnWidth && Math.abs(read.width / read.height - width / height) < 0.02, JSON.stringify(read))
  await drive.capture('Use node to write a red square PNG', () => drive.evaluate(send('Use node to write a 64 by 64 PNG of a red square to red.png. Do not install anything.')))
  // The turn-files header is Claude Code's "Edited N files" card.
  await drive.evaluate(`(async () => { for (const line of document.querySelectorAll('.lc-thread .lc-activity[aria-expanded="false"]')) line.click(); await new Promise(r => setTimeout(r, 1000)); return document.querySelector('.lc-thread')?.innerText.slice(-900) })()`)
  const edited = await drive.evaluate(`(() => {
    const img = [...document.querySelectorAll('.lc-thread .lc-turnfoot .lc-threadimage__picture')].find(img => img.alt.endsWith('red.png'))
    let pixel; if (img?.complete && img.naturalWidth) { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); pixel = [...ctx.getImageData(32,32,1,1).data] }
    return { painted: !!img && img.complete && img.naturalWidth === 64 && img.naturalHeight === 64, pixel, editedCard: !!img?.closest('.lc-turnfoot'), name: !![...document.querySelectorAll('.lc-thread .lc-filerow__path')].find(el => el.textContent.includes('red.png')), viewerButton: !!img?.closest('button') }
  })()`)
  check('edited red.png has a painted 64 by 64 red thumbnail', edited.painted && edited.pixel?.[0] === 255 && edited.pixel?.[1] === 0 && edited.pixel?.[2] === 0 && edited.pixel?.[3] === 255, JSON.stringify(edited))
  check('thumbnail is beneath its named edited-file row', edited.editedCard && edited.name, JSON.stringify(edited))
  await drive.capture('click red.png thumbnail to open the existing viewer', () => drive.evaluate(`(async () => {
    [...document.querySelectorAll('.lc-thread .lc-threadimage__picture')].find(img => img.alt.endsWith('red.png'))?.closest('button')?.click()
    await new Promise(r => setTimeout(r, 1200))
    const viewer = document.querySelector('.lc-viewer'); const img = viewer?.querySelector('img')
    return { viewer: !!viewer, named: viewer?.getAttribute('aria-label'), painted: !!img && img.complete && img.naturalWidth === 64 && img.naturalHeight === 64 }
  })()`))
  const viewer = await drive.evaluate(`(() => { const viewer = document.querySelector('.lc-viewer'); const img = viewer?.querySelector('img'); return { viewer: !!viewer, named: viewer?.getAttribute('aria-label'), painted: !!img && img.complete && img.naturalWidth === 64 && img.naturalHeight === 64 } })()`)
  check('clicking the thumbnail opens red.png in the existing image viewer', viewer.viewer && viewer.painted && /red\.png/.test(viewer.named), JSON.stringify(viewer))
  // Electron's own launch line in a packaged build is no error of the app's (as drive-an-always-never-outranks-a-rule.mjs).
  const LAUNCH_NOISE = /^Electron sandboxed_renderer\.bundle\.js script failed to run|^console\.error$/
  const errors = drive.record.flatMap((step) => step.errors.flat().map(String)).filter((line) => !LAUNCH_NOISE.test(line.trim()))
  check("renderer errors stay at zero, beyond Electron's launch line", errors.length === 0, JSON.stringify(errors))
} catch (error) { check('drive completes', false, String(error)) }
finally { await drive.finish({ intro: `Base ${tag}. Ash on Claude Code / Haiku 4.5 in Edit. Two requested image turns.`, extra: checks.join('\n\n') }); await writeFile(join(drive.out, 'checks.txt'), checks.join('\n') + '\n') }
say(`${checks.length - failures}/${checks.length} checks passed`)
process.exit(failures ? 1 : 0)
