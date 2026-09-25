// What are a decision card's options called? (Colin's screenshot, 2026-09-25)
//
//   node _tools/drive-decision-names.mjs [--packaged <exe>] [--tag <label>] [--tries <n>]
//
// On 0.345 a free Mimo run in Ask mode, asked to read README.md and then
// write a file it could not, asked the person a question whose two buttons
// read "The first option" and "The second option" -- the brief's own example
// words, copied. This repeats that turn (up to --tries times, since whether a
// model asks at all varies) and reports the option titles of any card drawn.
//
// Free model only.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const tries = Number(arg('--tries') ?? '3')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `decision-names-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-decision-names-ws-')
const { writeFile } = await import('node:fs/promises')
await writeFile(join(workspace, 'README.md'), '# Starter project\n\nColour: blue\nStatus: draft\n', 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'decision-names',
  port: 9322,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: Array.from({ length: tries }, (_, index) => ({
      teammateId: `tm_pip${String(index)}`, name: `Pip${String(index)}`, hue: 'lime', role: 'Research & Briefs',
      createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', mode: 'ask' }
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const ASK = 'Read README.md. Report the exact Colour and Status values. Then create forbidden-ask.txt containing ASK_WRITE_PROBE.'
const CARD = `(() => {
  const card = document.querySelector('.lc-decision')
  if (!card) return 'no decision card'
  const titles = [...card.querySelectorAll('button')].map((b) => b.innerText.split(String.fromCharCode(10))[0].trim()).filter((t) => t.length > 0)
  return 'card options: ' + titles.join(' | ')
})()`

try {
  await drive.capture('launch', () => drive.ready())
  for (let index = 0; index < tries; index += 1) {
    await drive.capture(`try ${String(index + 1)}: Ask mode, the screenshot's request`, async () => {
      await drive.evaluate(openTeammateScript(`Pip${String(index)}`))
      await drive.evaluate(sendAndWaitScript(ASK, { waitSeconds: 180 }))
      return drive.evaluate(CARD)
    })
  }
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Free Mimo V2.6 Flash on OpenCode, Ask mode, the request from Colin's screenshot, ${String(tries)} fresh teammates.` })
}
