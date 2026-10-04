// Does the brief hand over the note that answers the question when it shares
// no word with it? (0.454, memory recall by meaning.)
//
//   node _tools/drive-memory-by-meaning.mjs [--packaged <exe>] [--tag <name>]
//
// Twenty notes. The OLDEST says how the site goes live ("deploys from the
// gh-pages branch") and never says "publish" or "website". Six newer ones
// say "website" about other things -- the footer's gray, the favicon -- and
// thirteen are drive results. Ash is asked "How do I publish the website?".
// The brief has room for eight.
//
// The keyword brief fills its eight with the six "website" notes and the
// two newest, and leaves the answer out. The brief by meaning must give it.
// Read from what Locust records giving each note (A1.4), never from the
// reply; and the recall's own cache and the error log say whether the model
// actually ran, so a pass cannot come from the keyword path by luck.
//
// Run it against the build before (the control) and after.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `memory-by-meaning-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-meaning-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const DAY = 24 * 60 * 60 * 1000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()
const ANSWER = { memoryId: 'mem_answer', text: 'The site deploys from the gh-pages branch; pushing to it makes the change live within a minute.', days: 60 }
const WEBSITE = [
  'The website footer uses the brand gray, #6b7280, never pure black.',
  "The website's contact form posts to Formspree; its key is in the form's action URL.",
  'Screenshots on the website are 1600 pixels wide and saved as WebP.',
  'The website hero shows a rainbow border around the dashboard link.',
  'Website copy is written in second person and avoids the word "leverage".',
  'The website favicon is the {a_w} mark in blue and purple.'
].map((text, index) => ({ memoryId: `mem_web${String(index)}`, text, days: 40 - index }))
const AREAS = ['sidebar', 'composer', 'thread', 'settings', 'roster', 'memory screen', 'update banner', 'route picker', 'activity fold', 'room board']
const OTHER = Array.from({ length: 13 }, (_, index) => ({
  memoryId: `mem_run${String(index)}`,
  text: `On Locust 0.${String(300 + index)}.0 the ${AREAS[index % AREAS.length]} drive passed after its selector repair; the remaining failure is in the ${AREAS[(index + 3) % AREAS.length]}.`,
  days: 13 - index
}))
const NOTES = [ANSWER, ...WEBSITE, ...OTHER]

const drive = await startDrive({
  name: 'memory-by-meaning',
  port: 9647,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: ago(100), route: FREE_ROUTE }],
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
  await drive.capture('launch: twenty notes, the answer in the oldest, sharing no word with the question', () => drive.ready())
  await drive.capture('Ash is asked; the brief is read back from what Locust recorded giving', async () => {
    const opened = await drive.evaluate(openTeammateScript('Ash'))
    const said = opened.startsWith('opened') ? await drive.evaluate(sendAndWaitScript('How do I publish the website? One sentence.')) : opened
    const handed = await given()
    const cacheFile = join(drive.profile, 'memory-recall-cache.json')
    const cached = existsSync(cacheFile) ? Object.keys(JSON.parse(await readFile(cacheFile, 'utf8')).vectors ?? {}).length : 0
    const errors = existsSync(join(drive.profile, 'locust-errors.log')) ? await readFile(join(drive.profile, 'locust-errors.log'), 'utf8') : ''
    const recallErrors = errors.split('\n').filter((line) => /memory-recall/.test(line))
    const verdicts = [
      `the answer, oldest of all, no shared word: ${handed.has('mem_answer') ? 'GIVEN' : 'MISSING'}`,
      `notes given: ${String(handed.size)}`,
      `recall cache: ${String(cached)} notes embedded`,
      `recall errors: ${recallErrors.length === 0 ? 'none' : recallErrors.join(' / ')}`,
      `Ash mentions gh-pages: ${/gh-pages/i.test(said) ? 'yes' : 'no'}`
    ]
    const pass = handed.has('mem_answer') && cached >= NOTES.length && recallErrors.length === 0
    return `${pass ? 'PASS' : 'FAIL'} -- ${verdicts.join('; ')} || given: ${[...handed].sort().join(' ')} || Ash: ${said.slice(0, 160)}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Ash on the free OpenCode model; twenty notes, the answer in the oldest and sharing no word with the question, six newer ones that say "website" about something else.` })
}
