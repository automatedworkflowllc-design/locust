// What a person does in the terminal comes back (0.391).
//
//   LOCUST_SPEND=1 node _tools/drive-terminal-catch-up.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-27: "wont we want to be able to keep up on projects our
// users carry on w/ terminal?" Wren, on Claude Haiku -- two short turns, so
// it spends a little of the Claude account and asks for LOCUST_SPEND=1:
//   1. a first turn in Locust; the </> button says what happens there comes back;
//   2. THE SEAM: two exchanges are appended to that turn's own Claude session
//      file, shaped the way Claude Code's terminal writes a typed prompt
//      (`entrypoint: "cli"`) and its answer. A person typing into Claude
//      Code's terminal interface is the one thing this drive cannot do, so it
//      writes what that interface would have written -- to the session this
//      drive's own run made, never anyone else's;
//   3. the window comes back into focus: the thread shows them under "In
//      Claude Code's terminal", the ledger holds them as Wren's turns chained
//      after the first, and the sidebar still has ONE conversation;
//   4. focus again: nothing comes back twice;
//   5. a real follow-up in Locust continues after them, on the same session
//      -- so Claude knows what was said in the terminal -- under "Back in Locust";
//   6. closed and opened again: all of it is still there, once.

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { conversationRows, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const { createFileMissionLedger } = await import('../packages/mission-store/dist/index.js')

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('terminal-catch-up-2026-09-27'), `terminal-catch-up-${tag}`)
await mkdir(OUT, { recursive: true })
const PORT = 9691
const INTO = "In Claude Code's terminal"

const workspace = await scratchRepository('locust-terminal-catch-up-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-terminal-catch-up-'))
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
let drive = await startDrive({
  name: `terminal-catch-up-${tag}`,
  port: PORT,
  workspace,
  spends: true,
  keep: true,
  profilePath: profile,
  outPath: OUT,
  launchElsewhere: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const ledger = createFileMissionLedger({ rootDirectory: join(profile, 'mission-ledger') })
const missions = async () => (await ledger.listMissions()).missions
const owners = async () => JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).missionOwners ?? {}
const threadText = () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`)
const seams = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-thread .lc-handoff')].map((seam) => seam.getAttribute('aria-label')))`)))

/*
 * WHERE each part is, not just whether it is there. The first passing run
 * drew "Back in Locust" between the two terminal turns, and a presence check
 * called that a pass.
 */
const ORDER = ['first answer', 'IN CLAUDE CODE', 'remember the word lantern', 'Noted: lantern.', 'say the word back', 'The word is lantern.', 'BACK IN LOCUST', 'what word did I ask you to remember?']
const orderOf = (text) => ORDER.map((part) => `${part}@${String(text.toUpperCase().indexOf(part.toUpperCase()))}`).join(' ')
const inOrder = (text) => {
  const at = ORDER.map((part) => text.toUpperCase().indexOf(part.toUpperCase()))
  return at.every((index, i) => index >= 0 && (i === 0 || index > at[i - 1]))
}

/** The session file this drive's own run wrote, under the real Claude home. */
async function sessionFile(session) {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  for (const folder of await readdir(projects)) {
    const candidate = join(projects, folder, `${session}.jsonl`)
    if (await stat(candidate).then(() => true, () => false)) return candidate
  }
  return undefined
}

/**
 * THE SEAM: one exchange as Claude Code's terminal writes it -- the prompt
 * with `entrypoint: "cli"`, the answer with `stop_reason: "end_turn"`, each
 * chained to the line before by `parentUuid` so Claude itself reads them back
 * when the session is resumed.
 */
async function typeInTerminal(file, prompt, answer) {
  const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => { try { return JSON.parse(line) } catch { return undefined } }).filter(Boolean)
  const last = lines.filter((line) => typeof line.uuid === 'string').at(-1)
  const base = { isSidechain: false, userType: 'external', cwd: last.cwd, sessionId: last.sessionId, version: last.version, ...(last.gitBranch === undefined ? {} : { gitBranch: last.gitBranch }) }
  const asked = randomUUID()
  const said = randomUUID()
  const at = new Date()
  const user = { parentUuid: last.uuid, ...base, type: 'user', message: { role: 'user', content: prompt }, uuid: asked, timestamp: at.toISOString(), entrypoint: 'cli', promptSource: 'queued' }
  const assistant = {
    parentUuid: asked,
    ...base,
    message: { id: `msg_terminal_${said.slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    type: 'assistant',
    uuid: said,
    timestamp: new Date(at.getTime() + 1500).toISOString()
  }
  await appendFile(file, `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`, 'utf8')
}

let session
let firstMission
let handoff
try {
  await drive.ready()
  await drive.resize(1440, 900)
  say(String(await drive.evaluate(openTeammateScript('Wren'))))

  await drive.capture('1. a first turn in Locust', () => drive.evaluate(sendAndWaitScript('Reply with exactly the words: first answer. Do not use any tools.', { waitSeconds: 180 })))
  const first = (await missions())[0]
  firstMission = first?.metadata.missionId
  session = first?.events.find((event) => event.type === 'run.started')?.payload.runtimeThreadId
  check('the first turn ran on Claude and left a session', first?.metadata.runtime === 'claude' && typeof session === 'string', `${String(firstMission)} / ${String(session)}`)
  const title = String(await drive.evaluate(`document.querySelector('button[aria-label="Open in Claude Code, in a terminal"]')?.getAttribute('title') ?? 'NO BUTTON'`))
  check('the </> button says what happens there comes back', title.includes('What you do there comes back into this conversation'), title.replace(/\s+/g, ' '))

  const file = session === undefined ? undefined : await sessionFile(session)
  check("the run's own session file is found", file !== undefined, file)
  if (file === undefined) throw new Error('no session file')

  await drive.capture('2. THE SEAM: two exchanges typed "in the terminal", then the window comes back into focus', async () => {
    await typeInTerminal(file, 'Terminal check: remember the word lantern.', 'Noted: lantern.')
    await sleep(2100)
    await typeInTerminal(file, 'Terminal check: say the word back.', 'The word is lantern.')
    await drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
    for (let i = 0; i < 40; i += 1) {
      await sleep(500)
      if ((await seams()).includes(INTO) && String(await threadText()).includes('The word is lantern.')) break
    }
    return threadText()
  })
  const afterFocus = await missions()
  const terminal = afterFocus.filter((mission) => mission.metadata.startedBy?.kind === 'terminal').sort((a, b) => a.metadata.startedBy.exchange - b.metadata.startedBy.exchange)
  check('the ledger holds both exchanges as turns started in the terminal', terminal.length === 2 && terminal.every((mission) => mission.issues.length === 0 && mission.phase === 'completed'), terminal.map((mission) => `${mission.metadata.prompt} [${mission.phase}]`).join(' | '))
  check('chained after the first turn, in order', terminal[0]?.metadata.continuesFrom?.missionId === firstMission && terminal[1]?.metadata.continuesFrom?.missionId === terminal[0]?.metadata.missionId)
  const own = await owners()
  check("both are Wren's", terminal.every((mission) => own[mission.metadata.missionId] === 'tm_wren'))
  const text = String(await threadText())
  check('the thread shows them under the seam, the words and the answers', (await seams()).includes(INTO) && text.includes('Terminal check: remember the word lantern.') && text.includes('Noted: lantern.') && text.includes('The word is lantern.'), JSON.stringify(await seams()))
  const rows = JSON.parse(String(await drive.evaluate(`JSON.stringify(${conversationRows()}.map((row) => row.title))`)))
  check('still ONE conversation in the sidebar, under its first words', rows.length === 1, JSON.stringify(rows))

  await drive.capture('3. focus again: nothing comes back twice', async () => {
    await drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
    await sleep(2500)
    return threadText()
  })
  check('still two terminal turns after another focus', (await missions()).filter((mission) => mission.metadata.startedBy?.kind === 'terminal').length === 2)

  await drive.capture('4. a follow-up in Locust continues after them', () => drive.evaluate(sendAndWaitScript('In one short sentence: what word did I ask you to remember?', { waitSeconds: 180 })))
  const all = await missions()
  const follow = all.find((mission) => mission.metadata.startedBy === undefined && mission.metadata.missionId !== firstMission)
  const followSession = follow?.events.find((event) => event.type === 'run.started')?.payload.runtimeThreadId
  check('the follow-up continues from the last terminal turn', follow?.metadata.continuesFrom?.missionId === terminal[1]?.metadata.missionId, `${String(follow?.metadata.continuesFrom?.missionId)} vs ${String(terminal[1]?.metadata.missionId)}`)
  check('on the same session', followSession === session, String(followSession))
  const answer = String(await threadText())
  check('and Claude knew what was said in the terminal', /lantern/i.test(answer.slice(answer.lastIndexOf('what word did I ask you to remember?'))), answer.slice(-200))
  check('"Back in Locust" before it', (await seams()).includes('Back in Locust'), JSON.stringify(await seams()))
  check('in order: the terminal turns, then the seam back, then the reply', inOrder(String(await threadText())), orderOf(String(await threadText())))
  handoff = await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on Claude Haiku; the terminal exchanges are the seam described in the drive's header.`, last: false })
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  handoff = await drive.finish({ intro: 'failed part way', last: false }).catch(() => undefined)
}

if (handoff !== undefined) {
  try {
    // `spends` again, or the library moves Wren to a free route on the way in
    // -- nothing is sent after the relaunch, but her route should not move.
    drive = await startDrive({ name: `terminal-catch-up-${tag}`, port: PORT, workspace, spends: true, profilePath: handoff.profile, outPath: handoff.out, stepFrom: handoff.step, launchElsewhere: true, ...(packaged === undefined ? {} : { packaged }) })
    await drive.ready()
    await drive.resize(1440, 900)
    await drive.capture('5. closed and opened again: the conversation, as it was', async () => {
      await drive.evaluate(`(async () => {
        for (let i = 0; i < 40; i += 1) {
          const rows = ${conversationRows()}
          if (rows.length > 0) { rows[0].click(); return }
          await new Promise((r) => setTimeout(r, 250))
        }
      })()`)
      await sleep(3000)
      return threadText()
    })
    const reopened = await seams()
    check('the seams are drawn again after a restart', reopened.includes(INTO) && reopened.includes('Back in Locust'), JSON.stringify(reopened))
    check('and in the same order', inOrder(String(await threadText())), orderOf(String(await threadText())))
    check('and nothing was brought back twice', (await missions()).filter((mission) => mission.metadata.startedBy?.kind === 'terminal').length === 2)
  } catch (error) {
    failures += 1
    say(`reopen failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'closed and opened again on the same profile', extra: `Checks failed: ${String(failures)}` })
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
