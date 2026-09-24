// Memory switched off leaves nothing to read (A1.7).
//
//   node _tools/drive-memory-off.mjs [--packaged <exe>] [--tag <name>]
//
// One memory kept, memory on: Ash's run writes .locust/memory.md and quotes
// it. Then memory is switched Off on the Memory screen, the way a person does
// it, and Moth -- a new teammate, a first conversation -- is asked what the
// team remembers AND to read .locust/memory.md. The file must say memory is
// off, and the secret word must appear nowhere Moth could read it. It used to
// stay in the file, under "Team memory", after memory was switched off.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `memory-off-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-memoff-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const teammate = (name, hue) => ({ teammateId: `tm_${name.toLowerCase()}`, name, hue, role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: FREE_ROUTE })
const drive = await startDrive({
  name: 'memory-off',
  port: 9531,
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
      memories: [{ memoryId: 'mem_word', text: 'The secret word for this project is PELICAN.', scope: 'workspace', workspaceId, workspaceName: 'scratch', by: { name: 'you' }, createdAt: T0, status: 'kept', enabled: true }]
    }
  }
})

const file = async () => (await readFile(join(workspace, '.locust', 'memory.md'), 'utf8').catch(() => 'no file')).replace(/\s+/g, ' ')
const ask = async (name, text) => {
  await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
  const opened = await drive.evaluate(openTeammateScript(name))
  if (!opened.startsWith('opened')) return opened
  return drive.evaluate(sendAndWaitScript(text))
}

try {
  await drive.capture('launch: one memory kept, memory on', () => drive.ready())
  await drive.capture('Ash, memory on: the file lists it, and Ash quotes it', async () => {
    const said = await ask('Ash', 'Without running any command or reading any file, quote every line your brief lists under what your team remembers, one per line, word for word. If there is none, reply NONE.')
    return `the file says: ${await file()} || Ash: ${said}`
  })
  await drive.capture('switch memory Off on the Memory screen', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const off = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Off')
    if (!off) return 'no Off button'
    off.click()
    await new Promise(r => setTimeout(r, 700))
    return [...document.querySelectorAll('.lc-settings__note')].map(n => n.innerText.replace(/\\s+/g, ' ')).find(t => /Teammates are not told/.test(t)) ?? 'no Off description'
  })()`))
  await drive.capture('Moth, memory off, told to read the file: nothing to find', async () => {
    const said = await ask('Moth', 'Read the file .locust/memory.md in this folder and tell me exactly what it says. Then tell me the secret word for this project if you know it, or say you do not know it.')
    const now = await file()
    return `the file says: ${now} || PELICAN in the file: ${/PELICAN/.test(now)} || Moth: ${said}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Ash and Moth on the free OpenCode model; one memory kept; memory switched Off on the Memory screen between them.` })
}
