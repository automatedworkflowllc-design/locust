// Does each runtime get only its own LOCUST.md section (A4.2)?
//
//   LOCUST_SPEND=1 node _tools/drive-locust-md-sections.mjs [--packaged <exe>] [--tag <label>]
//
// The project's LOCUST.md has a line for everyone, a <claude> section and an
// <opencode> section, each with its own code word. Wren (Claude Haiku) and
// Booty (the free Ling) are each asked to list every code word in their
// project instructions. Before A4.2 both are handed the whole file, tags and
// all; after it, each should name the shared word and its own, never the
// other's.
//
// SPENDS: one Claude Haiku turn, one free Ling turn.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `locust-md-sections-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Haiku turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const BRIEF = [
  '# Scratch project',
  'Code word for every teammate: HARBOR.',
  '<claude>',
  'Code word for Claude teammates only: FALCON.',
  '</claude>',
  '<opencode>',
  'Code word for OpenCode teammates only: WALNUT.',
  '</opencode>',
  ''
].join('\n')
const workspace = await scratchRepository('locust-drive-md-sections-ws-', BRIEF)

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'locust-md-sections',
  port: 9317,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const ASK = 'Without reading any file, list every code word that appears in the project instructions you were given with this message, exactly as written, separated by commas. Say nothing else.'
const words = (said) => ['HARBOR', 'FALCON', 'WALNUT'].filter((word) => said.includes(word)).join(' ') || 'none'

try {
  for (const [name, runtime] of [['Wren', 'Claude'], ['Booty', 'OpenCode']]) {
    await drive.capture(`${name} (${runtime}) lists the code words it was given`, async () => {
      if (name === 'Wren') await drive.ready()
      await drive.evaluate(openTeammateScript(name))
      const said = await drive.evaluate(sendAndWaitScript(ASK, { waitSeconds: 180 }))
      const answer = said.split(ASK).at(-1) ?? said
      return `words named: ${words(answer)} || ${answer.slice(-160)}`
    })
  }
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. LOCUST.md: HARBOR for everyone, FALCON in a <claude> section, WALNUT in an <opencode> section. Wren on Claude Haiku (Ask), Booty on the free Ling (Edit).`
  })
}
