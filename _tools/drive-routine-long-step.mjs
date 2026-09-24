// A routine saved before 0.316 with a step too long to send (A5.1).
//
//   node _tools/drive-routine-long-step.mjs [--packaged <exe>] [--tag <name>]
//
// Seeded on disk as a person on an older build could have saved it: step 1
// short, step 2 about 8,400 characters. Run is pressed on the Routines
// screen. Step 1 runs on the free OpenCode model; step 2 must be refused as
// too long to send, with nothing started -- not held as "Dispatch not
// confirmed ... Review external work", which is what it used to say about a
// step that never began.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `routine-long-step-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-longstep-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const LONG = `Read the notes below and reply with the single word OK.\n\n${'The quarterly notes repeat here. '.repeat(254)}`
const drive = await startDrive({
  name: 'routine-long-step',
  port: 9532,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  },
  files: {
    'routines.json': {
      schemaVersion: 1,
      routines: [
        {
          routineId: 'rt_longstep',
          name: 'Quarterly notes',
          teammateId: 'tm_wren',
          route: FREE_ROUTE,
          steps: ['Reply with exactly the word ALPHA and nothing else.', LONG],
          learnedFrom: [],
          createdAt: T0,
          runs: 0
        }
      ]
    }
  }
})

const row = `[...document.querySelectorAll('.lc-routinerow')].find(r => /Quarterly notes/.test(r.innerText))`
try {
  await drive.capture(`launch: a routine whose step 2 is ${String(LONG.length)} characters`, () => drive.ready())
  await drive.capture('Routines: press Run', () => drive.evaluate(`(async () => {
    const nav = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Routines')
    if (!nav) return 'no Routines button'
    nav.click()
    await new Promise(r => setTimeout(r, 800))
    const found = ${row}
    if (!found) return 'no routine row: ' + (document.querySelector('.lc-screen__scroll')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? '')
    const run = [...found.querySelectorAll('button')].find(b => b.innerText.trim() === 'Run')
    if (!run || run.disabled) return 'Run not available: ' + found.innerText.replace(/\\s+/g, ' ')
    run.click()
    await new Promise(r => setTimeout(r, 1500))
    return 'pressed Run || ' + (${row})?.innerText.replace(/\\s+/g, ' ')
  })()`))
  await drive.capture('step 1 runs, step 2 is refused: what the row and the thread say', () => drive.evaluate(`(async () => {
    const nav = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Routines')
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 750))
      nav?.click()
      const text = (${row})?.innerText.replace(/\\s+/g, ' ') ?? ''
      if (/too long|review|held|stopped/i.test(text)) break
    }
    const text = (${row})?.innerText.replace(/\\s+/g, ' ') ?? 'no row'
    // The thread of the step that ran carries the routine's notice.
    const conversation = document.querySelector('.lc-conv')
    conversation?.click()
    await new Promise(r => setTimeout(r, 1200))
    const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
    const said = thread.match(/Routine "Quarterly notes"[^.]*\\.[^.]*\\.?[^.]*/g) ?? []
    return 'row: ' + text + ' || notices: ' + said.join(' / ') + ' || Dispatch not confirmed anywhere: ' + /Dispatch not confirmed/.test(text + thread)
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on the free OpenCode model; a routine seeded as an older build could have saved it.` })
}
