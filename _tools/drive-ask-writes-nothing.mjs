// Ask writes nothing, on whatever route OpenCode runs (0.677).
//
//   node _tools/drive-ask-writes-nothing.mjs [--packaged <exe>] [--tag <name>]
//
// 0.677 moved every OpenCode mode onto OpenCode's own server, so replies stream. A mode must mean there what it
// meant on `run`, and Ask's meaning is the one that cannot slip: nothing written. A teammate on a free model, in Ask,
// is told to create a file with its edit tool and another through the shell; afterwards neither exists and the
// folder is as it was. The control, same words in Edit: the file is made -- the model does try. Spends nothing.

import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const ASK = 'Create a file named made.txt holding the single word hi, using your file tool. Then run this shell command: echo hi > shell.txt. Then reply DONE.'
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}

const turn = async (mode) => {
  const workspace = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), `locust-drive-ask-writes-${mode}-`))
  await writeFile(join(workspace, 'notes.txt'), 'untouched\n')
  const drive = await startDrive({
    ...(packaged === undefined ? {} : { packaged }),
    name: `ask-writes-nothing-${mode}-${tag}`, port: 9781, workspace,
    outPath: join(recordRoot('ask-writes-nothing-2026-10-06'), `${mode}-${tag}`),
    seed: {
      schemaVersion: 1,
      teammates: [{ teammateId: 'tm_moth', name: 'Moth', hue: 'violet', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-10-06T00:00:00.000Z', route: { ...FREE_ROUTE, mode } }],
      missionOwners: {},
      settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
    }
  })
  try {
    await drive.ready()
    await drive.resize(1200, 820)
    await drive.evaluate(openTeammateScript('Moth'))
    const sent = String(await drive.capture(`Moth, in ${mode}, told to write two files`, () => drive.evaluate(sendAndWaitScript(ASK))))
    say(`  ${mode}: ${sent.slice(0, 140)}`)
    return { workspace, files: await readdir(workspace) }
  } finally {
    await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Moth on ${FREE_ROUTE.model}, ${mode}.`, extra: `Checks failed: ${String(failures)}` })
  }
}

try {
  const ask = await turn('ask')
  check('Ask: no file was made with the file tool', !existsSync(join(ask.workspace, 'made.txt')), JSON.stringify(ask.files))
  check('Ask: no file was made through the shell', !existsSync(join(ask.workspace, 'shell.txt')), JSON.stringify(ask.files))
  check('Ask: the folder is as it was', JSON.stringify(ask.files) === JSON.stringify(['notes.txt']), JSON.stringify(ask.files))
  const edit = await turn('accept-edits')
  check('the control, Edit: the same words make made.txt (the model does try)', existsSync(join(edit.workspace, 'made.txt')), JSON.stringify(edit.files))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
