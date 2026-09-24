// A memory no teammate has been given in a month says so (A1.4).
//
//   node _tools/drive-memory-unused.mjs [--packaged <exe>] [--tag <name>]
//
// Ten memories, three months old, and Locust has been counting which ones
// teammates are given for 40 days -- none of them has been. The Memory screen
// must mark all ten. Then one teammate run: its brief pastes a few (the
// brief is bounded; the rest are in the file), those are noted as given, and
// the Memory screen, read again, must mark only the ones that were not.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

/*
 * Free by default. LOCUST_DRIVE_CLAUDE=1 runs the teammates on Claude Haiku
 * instead -- for when the OpenCode free tier is down (2026-09-24) -- and says
 * the drive spends, so it also needs LOCUST_SPEND=1.
 */
const ON_CLAUDE = process.env.LOCUST_DRIVE_CLAUDE === '1'
const ROUTE = ON_CLAUDE ? { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } : FREE_ROUTE

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `memory-unused-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-unused-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const DAY = 24 * 60 * 60 * 1000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()
const NOTES = [
  'The staging database is called shop-staging.',
  'Invoices are generated on the first of the month.',
  'Feature flags live in the flags table.',
  'The design system uses an 8-pixel grid.',
  'Error reports go to the ops channel.',
  'The mobile app pins API version 3.',
  'Customer exports are CSV, never Excel.',
  'Load tests run against staging only.',
  'The support rota changes on Mondays.',
  'Release notes are written by whoever merges.'
]
const drive = await startDrive({
  spends: ON_CLAUDE,
  name: 'memory-unused',
  port: 9536,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: ago(100), route: ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      briefTrackingSince: ago(40),
      memories: NOTES.map((text, index) => ({
        memoryId: `mem_n${String(index)}`,
        text,
        scope: 'workspace',
        workspaceId,
        workspaceName: 'scratch',
        by: { name: 'you' },
        createdAt: ago(90),
        status: 'kept',
        enabled: true
      }))
    }
  }
})

const marked = `(async () => {
  document.querySelector('.lc-brand__lockup').click()
  await new Promise(r => setTimeout(r, 400))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
  await new Promise(r => setTimeout(r, 900))
  const rows = [...document.querySelectorAll('.lc-memory')]
  const unused = rows.filter(r => /No teammate has been given this in \\d+ days/.test(r.innerText))
  return String(unused.length) + ' of ' + String(rows.length) + ' marked || ' + unused.map(r => r.querySelector('.lc-memory__text')?.innerText + ' / ' + (r.innerText.match(/No teammate[^.]*\\./) ?? [''])[0]).join(' | ')
})()`

try {
  await drive.capture('launch: ten memories, none given to anyone in the 40 days Locust has counted', () => drive.ready())
  await drive.capture('the Memory screen: all ten marked', () => drive.evaluate(marked))
  await drive.capture('one teammate run: the file it reads marks them too', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    const opened = await drive.evaluate(openTeammateScript('Ash'))
    const said = opened.startsWith('opened') ? await drive.evaluate(sendAndWaitScript('Reply with the single word OK.')) : opened
    const lines = (await readFile(join(workspace, '.locust', 'memory.md'), 'utf8').catch(() => '')).split(/\r?\n/).filter((line) => line.startsWith('- '))
    return `${String(lines.filter((line) => /not given to a teammate in \d+ days/.test(line)).length)} of ${String(lines.length)} lines marked in the file || Ash: ${said.slice(0, 80)}`
  })
  await drive.capture('the Memory screen, read again: only the ones the brief did not paste are still marked', () => drive.evaluate(marked))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Ash on ${ON_CLAUDE ? 'Claude Haiku' : 'the free OpenCode model'}; ten memories, three months old, counting begun 40 days ago.` })
}
