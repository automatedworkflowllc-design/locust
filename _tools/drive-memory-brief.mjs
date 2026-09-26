// Which notes a teammate is handed, read from the app's own record (0.352).
//
//   node _tools/drive-memory-brief.mjs [--packaged <exe>] [--tag <name>]
//
// Twenty notes: the OLDEST holds the one answer ("the pelican project's
// release codename"), and nineteen newer ones are long notes that all say
// Locust -- nearly every note in Colin's store does. The brief has room for
// only a few of them. Ash is asked the question, and the drive reads which
// notes the brief pasted from what Locust itself records about each one
// (A1.4 notes every memory a teammate is given).
//
// It must have given: the answer (a rare word matched it, however old), and
// the NEWEST of the rest -- 0.351 filled in date order and spent the room from
// the front, so the note written last was the first one cut. It must not
// have given the oldest of the nineteen.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

/*
 * Free by default. LOCUST_DRIVE_CLAUDE=1 runs Ash on Claude Haiku instead --
 * for when the OpenCode free tier is down -- and says the drive spends, so it
 * also needs LOCUST_SPEND=1.
 */
const ON_CLAUDE = process.env.LOCUST_DRIVE_CLAUDE === '1'
const ROUTE = ON_CLAUDE ? { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } : FREE_ROUTE

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `memory-brief-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-brief-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const DAY = 24 * 60 * 60 * 1000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()
const AREAS = ['sidebar', 'composer', 'thread', 'settings', 'roster', 'memory screen', 'update banner', 'route picker', 'activity fold', 'room board']
const ANSWER = { memoryId: 'mem_answer', text: "The pelican project's release codename is MARZIPAN.", days: 60 }
const REST = Array.from({ length: 19 }, (_, index) => ({
  memoryId: `mem_g${String(index)}`,
  text: `On Locust 0.${String(300 + index)}.0 the ${AREAS[index % AREAS.length]} drive passed after its selector repair; the two remaining failures were in the ${AREAS[(index + 3) % AREAS.length]} and are written up in the beta report for that build, with screenshots.`,
  // g0 is the oldest of them, g18 the newest (yesterday).
  days: 19 - index
}))
const NOTES = [ANSWER, ...REST]

const drive = await startDrive({
  spends: ON_CLAUDE,
  name: 'memory-brief',
  port: 9612,
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
      briefTrackingSince: ago(1),
      memories: NOTES.map((note) => ({
        memoryId: note.memoryId,
        text: note.text,
        scope: 'workspace',
        workspaceId,
        workspaceName: 'scratch',
        by: { name: 'you' },
        createdAt: ago(note.days),
        status: 'kept',
        enabled: true
      }))
    }
  }
})

/** Which notes Locust recorded as given to a teammate, read from its own file. */
async function given() {
  const store = JSON.parse(await readFile(join(drive.profile, 'memories.json'), 'utf8'))
  return new Set(store.memories.filter((memory) => typeof memory.lastBriefedAt === 'string').map((memory) => memory.memoryId))
}

try {
  await drive.capture('launch: twenty notes, the answer in the oldest', () => drive.ready())
  await drive.capture('Ash is asked; the brief is read back from what Locust recorded giving', async () => {
    const opened = await drive.evaluate(openTeammateScript('Ash'))
    const said = opened.startsWith('opened') ? await drive.evaluate(sendAndWaitScript("What is the pelican project's release codename? Answer in one word.")) : opened
    const handed = await given()
    const verdicts = [
      `the answer, oldest of all: ${handed.has('mem_answer') ? 'GIVEN' : 'MISSING'}`,
      `the newest note: ${handed.has('mem_g18') ? 'GIVEN' : 'MISSING'}`,
      `the oldest of the nineteen: ${handed.has('mem_g0') ? 'GIVEN (wrong end kept)' : 'left out'}`,
      `Ash says MARZIPAN: ${/marzipan/i.test(said) ? 'yes' : 'no'}`
    ]
    const pass = handed.has('mem_answer') && handed.has('mem_g18') && !handed.has('mem_g0')
    return `${pass ? 'PASS' : 'FAIL'} -- ${verdicts.join('; ')} || given: ${[...handed].sort().join(' ')} || Ash: ${said.slice(0, 120)}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Ash on ${ON_CLAUDE ? 'Claude Haiku' : 'the free OpenCode model'}; twenty notes, the answer in the oldest, nineteen long newer ones that all say Locust.` })
}
