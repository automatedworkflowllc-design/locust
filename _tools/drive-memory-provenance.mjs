// A memory whose file changed says it may be out of date (A1.3).
//
//   node _tools/drive-memory-provenance.mjs [--packaged <exe>] [--tag <name>]
//
// Two memories name files in the project. "Setup is described in
// README.md." was written on Sep 5, and README.md is newer: it may be out of
// date from the start. "Retries live in src/net.ts." was written a minute ago,
// after src/net.ts last changed: it is current -- until the drive edits
// src/net.ts, the way a person or a teammate would. Then the Memory screen
// and the brief of the next teammate's run must say so, naming the file.

import { createHash } from 'node:crypto'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

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
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `memory-provenance-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-provenance-ws-')
await mkdir(join(workspace, 'src'), { recursive: true })
await writeFile(join(workspace, 'src', 'net.ts'), 'export const RETRIES = 3\n', 'utf8')
await writeFile(join(workspace, 'README.md'), '# scratch\n\nRun pnpm install.\n', 'utf8')
// src/net.ts last changed yesterday; the memory about it is from a minute ago.
const yesterday = (Date.now() - 24 * 60 * 60 * 1000) / 1000
await utimes(join(workspace, 'src', 'net.ts'), yesterday, yesterday)
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const memory = (memoryId, text, createdAt) => ({ memoryId, text, scope: 'workspace', workspaceId, workspaceName: 'scratch', by: { name: 'you' }, createdAt, status: 'kept', enabled: true })
const teammate = (name, hue) => ({ teammateId: `tm_${name.toLowerCase()}`, name, hue, role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: ROUTE })
const drive = await startDrive({
  spends: ON_CLAUDE,
  name: 'memory-provenance',
  port: 9535,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [teammate('Ash', 'clay'), teammate('Moth', 'teal')],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      memories: [
        memory('mem_readme', 'Setup is described in README.md.', '2026-09-05T05:00:00.000Z'),
        memory('mem_net', 'Retries live in src/net.ts.', new Date(Date.now() - 60 * 1000).toISOString())
      ]
    }
  }
})

const QUOTE = 'Without running any command or reading any file, quote every line your brief lists under what your team remembers, one per line, word for word, with anything said beside it.'
const file = async () => (await readFile(join(workspace, '.locust', 'memory.md'), 'utf8').catch(() => 'no file')).split(/\r?\n/).filter((line) => line.startsWith('- ')).join(' / ')
const quote = async (name) => {
  await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
  const opened = await drive.evaluate(openTeammateScript(name))
  const said = opened.startsWith('opened') ? await drive.evaluate(sendAndWaitScript(QUOTE)) : opened
  return `the file says: ${await file()} || ${name}: ${said}`
}
const memoryRows = `(async () => {
  document.querySelector('.lc-brand__lockup').click()
  await new Promise(r => setTimeout(r, 400))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
  await new Promise(r => setTimeout(r, 900))
  return [...document.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 160)).join(' | ')
})()`

try {
  await drive.capture('launch: two memories name files; README.md is newer than its memory', () => drive.ready())
  await drive.capture('the Memory screen: README.md’s memory may be out of date, src/net.ts’s is current', () => drive.evaluate(memoryRows))
  await drive.capture('Ash’s brief: the file marks one', () => quote('Ash'))
  await drive.capture('src/net.ts is edited', async () => {
    await writeFile(join(workspace, 'src', 'net.ts'), 'export const RETRIES = 5\n', 'utf8')
    return 'wrote src/net.ts'
  })
  await drive.capture('the Memory screen, read again: both may be out of date now', () => drive.evaluate(memoryRows))
  await drive.capture('Moth’s brief: the file marks both', () => quote('Moth'))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Ash and Moth on ${ON_CLAUDE ? 'Claude Haiku' : 'the free OpenCode model'}; two memories naming files in the project.` })
}
