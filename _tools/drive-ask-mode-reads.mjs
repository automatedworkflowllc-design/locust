// Can a teammate in Ask mode on OpenCode do what it is asked? (A2.20)
//
//   node _tools/drive-ask-mode-reads.mjs [--packaged <exe>] [--tag <name>]
//
// Six teammates on the free OpenCode model, every one in Ask mode, each asked
// something in its FIRST conversation. In Ask mode OpenCode rejects every
// shell call and the run ends there, so a model that orients itself with
// `cat` or `git log` before answering never answers.
//
// The tasks are the ones that ended that way on the 0.315 drive, not a
// convenient one: a first run of this drive asked each teammate to quote a
// file not in its brief, and all six used their read tool and quoted it
// (ask-mode-reads-file-quote-before-local). The shell comes out when a model
// ORIENTS itself -- "I need to check the current memory state first" -- so:
//
//   Wren, Booty, Ash   quote what the team remembers (one seeded memory)
//   Moth, Fern, Kite   say what this project is and what state it is in
//
// Counted per run: done, ended on the shell, or neither. Run it on the build
// before a change and on the build after; the two counts are the evidence.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `ask-mode-reads-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-askreads-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const QUOTE = 'Your brief lists what your team remembers. Quote every remembered line, one per line, word for word. If there is none, reply NONE.'
const LOOK = 'Look around this project and tell me, in two sentences, what it is and what state it is in.'
const TEAM = [
  { name: 'Wren', hue: 'lime', task: QUOTE },
  { name: 'Booty', hue: 'blue', task: QUOTE },
  { name: 'Ash', hue: 'clay', task: QUOTE },
  { name: 'Moth', hue: 'teal', task: LOOK },
  { name: 'Fern', hue: 'rose', task: LOOK },
  { name: 'Kite', hue: 'butter', task: LOOK }
]
const drive = await startDrive({
  name: 'ask-mode-reads',
  port: 9529,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: TEAM.map((one) => ({
      teammateId: `tm_${one.name.toLowerCase()}`,
      name: one.name,
      hue: one.hue,
      role: 'Custom',
      roleTitle: 'Reader',
      createdAt: T0,
      route: { ...FREE_ROUTE, mode: 'ask' }
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      memories: [{ memoryId: 'mem_seed', text: 'The secret word for this project is PELICAN.', scope: 'workspace', workspaceId, workspaceName: 'scratch', by: { name: 'you' }, createdAt: T0, status: 'kept', enabled: true }]
    }
  }
})

// What the finished run came to, read off the thread the person sees.
const outcome = (task) => `(() => {
  const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
  if (/Ask mode does not change files, so this run stopped/.test(thread)) return 'ENDED ON THE SHELL'
  if (document.querySelector('.lc-card.is-terminal.is-red')) return 'NEITHER (failed): ' + thread.slice(-200)
  ${task === QUOTE ? `if (/PELICAN/.test(thread)) return 'DONE: quoted it'` : `if (thread.length > 0) return 'DONE: answered'`}
  return 'NEITHER: ' + thread.slice(-200)
})()`

const tally = { done: 0, shell: 0, neither: 0 }
try {
  await drive.capture('launch: six teammates, every one in Ask mode', () => drive.ready())
  for (const one of TEAM) {
    await drive.capture(`${one.name}: ${one.task === QUOTE ? 'quote the team memory' : 'what is this project'}`, async () => {
      await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
      const opened = await drive.evaluate(openTeammateScript(one.name))
      if (!opened.startsWith('opened')) return opened
      await drive.evaluate(sendAndWaitScript(one.task))
      const seen = await drive.evaluate(outcome(one.task))
      if (seen.startsWith('DONE')) tally.done += 1
      else if (seen === 'ENDED ON THE SHELL') tally.shell += 1
      else tally.neither += 1
      return seen
    })
  }
  await drive.capture('the count', async () => `done ${String(tally.done)} of ${String(TEAM.length)}; ended on the shell ${String(tally.shell)}; neither ${String(tally.neither)}`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Six teammates on the free OpenCode model, all in Ask mode, each asked in its first conversation: three to quote the team memory, three what the project is.` })
}
