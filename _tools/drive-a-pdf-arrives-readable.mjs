// An attached PDF arrives readable, on every runtime (0.713).
//
//   node _tools/drive-a-pdf-arrives-readable.mjs                       (a free OpenCode model)
//   LOCUST_SPEND=1 node _tools/drive-a-pdf-arrives-readable.mjs --route codex   (Codex, its cheapest model)
//
// A tester attached his homework to a Codex conversation on 0.712: Codex's PDF
// skill wanted Python packages his machine did not have, the sandbox stopped
// pip, and eight commands later (four failed) it decoded the file by hand --
// 1m 39s, against 33 s in Codex's own app. Locust now opens the PDF itself: its
// text and a picture of each page, beside the attachment, named in the message.
//
// The PDF is made here, from outside the folder (so it is copied in, as his
// was): a sheet with a 3x3 matrix whose row 2, column 3 is 47, a number written
// nowhere else. Checked, in order:
//   1. attaching it writes the text and the page picture into .locust/attachments,
//      before anything is sent, and the text keeps the matrix's rows apart;
//   2. the agent answers 47;
//   3. no command the agent ran exited non-zero.

import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const route = arg('--route') ?? 'free'
if (route !== 'free' && route !== 'codex') throw new Error('--route is free or codex')
if (route === 'codex' && process.env.LOCUST_SPEND !== '1') throw new Error('The Codex route spends: run it with LOCUST_SPEND=1.')

/** A one-page PDF, written by hand: Helvetica, a title, a question and a bracketed matrix. */
function practiceSheet() {
  const text = (size, x, y, words) => `BT /F1 ${size} Tf ${x} ${y} Td (${words}) Tj ET`
  const rows = [['3', '8', '1'], ['5', '2', '47'], ['9', '6', '4']]
  const cells = rows.flatMap((row, r) => row.map((cell, c) => text(12, 140 + c * 44, 610 - r * 22, cell)))
  const content = [
    text(18, 72, 720, 'Practice sheet 3'),
    text(11, 72, 690, 'Problem 2. The matrix B is printed below. Find the entry in row 2, column 3.'),
    text(12, 92, 588, 'B ='),
    ...cells,
    // The brackets, drawn as lines -- as TeX draws them, never as text.
    '0.8 w 128 626 m 122 626 l 122 558 l 128 558 l S',
    '0.8 w 248 626 m 254 626 l 254 558 l 248 558 l S'
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

const outside = await mkdtemp(join(tmpdir(), 'locust-drive-pdf-outside-'))
const pdfPath = join(outside, 'Practice sheet 3.pdf')
await writeFile(pdfPath, practiceSheet())
const workspace = await scratchRepository('locust-drive-pdf-ws-')
const attachments = join(workspace, '.locust', 'attachments')

const drive = await startDrive({
  name: `a-pdf-arrives-readable-${route}`,
  port: 9871,
  workspace,
  env: { LOCUST_ATTACH_PATHS: pdfPath },
  spends: route === 'codex',
  sendsNothing: false,
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed, detail })
  say(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture(`choose the route: ${route}`, () =>
    drive.evaluate(
      route === 'codex'
        ? pickRouteScript({ group: '/codex/i', search: 'luna', row: '/luna/i' })
        : pickRouteScript({ group: '/opencode/i', search: 'space bunny', row: '/space.bunny/i' })
    )
  )
  const chip = String(await drive.evaluate(`document.querySelector('.lc-control[aria-haspopup="listbox"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
  const routeOk = route === 'codex' ? /codex/i.test(chip) && /luna/i.test(chip) : /opencode/i.test(chip) && /free|bunny/i.test(chip)
  check('the route is the one this drive may send on', routeOk, chip)
  if (!routeOk) throw new Error(`Refusing to send on "${chip}".`)

  await drive.capture('attach the PDF, as the picker would', () => drive.evaluate(`(async () => {
    const plus = document.querySelector('button[data-satellite="attach"]')
    if (!plus) return 'no attach control'
    plus.click()
    await new Promise(r => setTimeout(r, 900))
    return [...document.querySelectorAll('.lc-attached__tile')].map(t => t.textContent?.trim()).join(' | ') || 'NO TILE'
  })()`))

  // 1. Opened on attach: the text and the picture are there before Send.
  let names = []
  for (let i = 0; i < 40; i += 1) {
    names = await readdir(attachments).catch(() => [])
    if (names.includes('Practice sheet 3.pdf.txt')) break
    await sleep(500)
  }
  const pictures = await readdir(join(attachments, 'Practice sheet 3.pdf-pages')).catch(() => [])
  check('attaching writes the text and a picture of the page, before Send', names.includes('Practice sheet 3.pdf.txt') && pictures.includes('page-01.png'), JSON.stringify({ names, pictures }))
  const text = await readFile(join(attachments, 'Practice sheet 3.pdf.txt'), 'utf8').catch(() => '')
  check('the text keeps the matrix rows apart', /3\s+8\s+1/.test(text) && /5\s+2\s+47/.test(text) && /9\s+6\s+4/.test(text), JSON.stringify(text.slice(0, 400)))
  const picture = await stat(join(attachments, 'Practice sheet 3.pdf-pages', 'page-01.png')).catch(() => undefined)
  check('the picture is a real page, not an empty canvas', picture !== undefined && picture.size > 8_000, `${String(picture?.size ?? 0)} bytes`)

  // 2. The answer.
  const started = Date.now()
  await drive.capture('ask for row 2, column 3', () =>
    drive.evaluate(sendAndWaitScript('What is the entry in row 2, column 3 of the matrix B in the attached PDF? Answer with the number only.', { waitSeconds: 300 }))
  )
  const seconds = Math.round((Date.now() - started) / 1000)
  const thread = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`))
  const reply = String(await drive.evaluate(`[...document.querySelectorAll('.lc-agentline__body')].map(n => n.innerText).join(' | ').slice(-400)`))
  check('the agent answers 47', /\b47\b/.test(reply.length > 0 ? reply : thread.slice(-600)), `${String(seconds)} s; ${(reply.length > 0 ? reply : thread.slice(-300)).replace(/\s+/g, ' ')}`)

  // 3. No failed commands: the footer counts them ("ran 8 commands · 4 exited non-zero").
  const footer = String(await drive.evaluate(`[...document.querySelectorAll('.lc-thread *')].map(n => n.childElementCount === 0 ? n.textContent : '').filter(t => /ran \\d+ command|exited non-zero/.test(t ?? '')).join(' | ')`))
  check('no command the agent ran exited non-zero', !/exited non-zero/.test(thread), footer.length > 0 ? footer : 'no commands counted')
  await drive.capture('the turn, folded open', () => drive.evaluate(`(async () => {
    const fold = [...document.querySelectorAll('.lc-thread button')].find(b => /worked|ran|read|steps?/i.test(b.innerText ?? ''))
    fold?.click()
    await new Promise(r => setTimeout(r, 600))
    return fold ? fold.innerText.replace(/\\s+/g, ' ').trim() : 'no fold'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  results.push({ name: 'the drive ran to the end', passed: false, detail: error instanceof Error ? error.message : String(error) })
} finally {
  await drive.finish({
    intro: `An attached PDF, opened by Locust for the agent (0.713), on ${route === 'codex' ? 'Codex (its cheapest model)' : 'a free OpenCode model'}.`,
    extra: results.map((r) => `- ${r.passed ? 'PASS' : 'FAIL'} ${r.name}${r.detail === undefined ? '' : `: ${r.detail}`}`).join('\n')
  })
}
const failed = results.filter((r) => !r.passed)
say(failed.length === 0 ? 'A PDF ARRIVES READABLE: ALL PASSED' : `${String(failed.length)} FAILED`)
process.exitCode = failed.length === 0 ? 0 : 1
