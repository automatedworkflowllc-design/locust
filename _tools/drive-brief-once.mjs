// Is a resumed conversation briefed once, then told only what changed (A2.5)?
//
//   LOCUST_SPEND=1 node _tools/drive-brief-once.mjs [--codex] [--packaged <exe>] [--tag <name>]
//
// --codex runs the same turns on Codex (gpt-5.6-luna, low effort) and reads
// Codex's own rollout for the scratch folder instead: Codex resumes through
// its app-server thread, a different path from Claude Code's --resume.
//
// Three Haiku turns with Wren in one conversation. The first is briefed in
// full; the second and third resume Claude Code's own session and should be
// sent one line in place of the standing brief. What the RUNTIME received is
// read from Claude Code's own session file for the scratch folder -- the host's
// record says what it meant to send, the session says what arrived. Turn two
// asks for a message to Booty with the share block, so the short brief has to
// have kept the form working; turn three asks Wren its role and teammate. Spends
// three cheap turns; replies are off, so Booty never runs.

import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `brief-once-${tag}`)

const workspace = await scratchRepository('locust-drive-brief-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-brief-profile-'))
const T0 = '2026-09-05T05:00:00.000Z'
const ON_CODEX = process.argv.includes('--codex')
const ROUTE = ON_CODEX
  ? { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask', effort: 'low' }
  : { runtime: 'claude', model: 'haiku', mode: 'ask' }
const drive = await startDrive({
  name: 'brief-once',
  port: 9538,
  workspace,
  profilePath,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'on', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const turn = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]') && !document.querySelector('.lc-livestep')) break
  }
  await new Promise((r) => setTimeout(r, 1500))
  const said = [...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((node) => node.innerText.trim())
  const peers = [...document.querySelectorAll('.lc-peer__toggle')].map((node) => node.innerText.replace(/\\s+/g, ' ').trim())
  return JSON.stringify({ last: said.at(-1) ?? '', peers })
})()`

/** The user messages Codex's own rollout holds for this folder, oldest first. */
async function codexTurns() {
  const day = join(homedir(), '.codex', 'sessions', ...new Date().toISOString().slice(0, 10).split('-'))
  const files = (await readdir(day).catch(() => [])).filter((name) => name.startsWith('rollout-') && name.endsWith('.jsonl'))
  const turns = []
  for (const file of files) {
    const lines = (await readFile(join(day, file), 'utf8')).split('\n').filter((line) => line.trim().length > 0)
    let meta
    try { meta = JSON.parse(lines[0] ?? '{}') } catch { continue }
    // Only the scratch folder's own sessions are read.
    if (meta.type !== 'session_meta' || String(meta.payload?.cwd ?? '').toLowerCase() !== workspace.toLowerCase()) continue
    for (const line of lines) {
      let record
      try { record = JSON.parse(line) } catch { continue }
      // Codex 0.156.1 keeps the prompt as a user `message` response item (the
      // first run of this drive looked for `event_msg` / `user_message`,
      // which that version does not write, and read nothing).
      if (record.type !== 'response_item' || record.payload?.type !== 'message' || record.payload?.role !== 'user') continue
      const text = (record.payload.content ?? []).map((part) => String(part?.text ?? '')).join('\n')
      // Codex's own context rides as user messages too; only Locust's prompt counts.
      if (text.length === 0 || /^<(recommended_plugins|environment_context|user_instructions|permissions)/.test(text)) continue
      turns.push({ at: record.timestamp ?? '', file, text })
    }
  }
  return { folder: day, turns: turns.sort((a, b) => a.at.localeCompare(b.at)) }
}

/** The user messages Claude Code's own session holds for this folder, oldest first. */
async function sessionTurns() {
  if (ON_CODEX) return codexTurns()
  const folder = join(homedir(), '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'))
  const files = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const turns = []
  for (const file of files) {
    for (const line of (await readFile(join(folder, file), 'utf8')).split('\n')) {
      if (line.trim().length === 0) continue
      let record
      try { record = JSON.parse(line) } catch { continue }
      if (record.type !== 'user' || record.isMeta === true || record.isCompactSummary === true) continue
      const content = record.message?.content
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : ''
      if (text.length === 0) continue
      turns.push({ at: record.timestamp ?? '', file, text })
    }
  }
  return { folder, turns: turns.sort((a, b) => a.at.localeCompare(b.at)) }
}

try {
  await drive.capture(`launch: Wren and Booty on ${ON_CODEX ? 'Codex gpt-5.6-luna' : 'Claude Haiku'}, memory on, replies off`, () => drive.ready())
  await drive.evaluate(`(async () => { const wren = ${teammateFace('Wren')}; wren.click(); await new Promise((r) => setTimeout(r, 600)) })()`)
  const one = JSON.parse(await drive.capture('turn one: briefed in full', () => drive.evaluate(turn('Reply with exactly: READY.'))))
  say(`turn one said: ${one.last.slice(0, 120)}`)
  const two = JSON.parse(await drive.capture('turn two: a message to Booty, on the short brief', () => drive.evaluate(turn('Send your teammate Booty one message with the share block, saying exactly: The build is green. Say nothing else.'))))
  say(`turn two said: ${two.last.slice(0, 160)} || peers: ${two.peers.join(' | ')}`)
  const three = JSON.parse(await drive.capture('turn three: does it still know who it is', () => drive.evaluate(turn('In one sentence: what is your role here, and what is the name of your teammate?'))))
  say(`turn three said: ${three.last.slice(0, 200)}`)

  const { folder, turns } = await sessionTurns()
  say(`${ON_CODEX ? 'Codex rollout' : 'Claude Code session'} folder: ${folder}; user turns found: ${String(turns.length)}; lengths: ${turns.map((entry) => String(entry.text.length)).join(', ')}`)
  const full = turns[0]
  check('turn one reached the runtime with the whole brief', full !== undefined && full.text.includes("Writing a teammate's name in your reply does NOT reach them"), full === undefined ? 'no user turn in the session' : `${String(full.text.length)} characters`)
  for (const [index, entry] of turns.slice(1, 3).entries()) {
    check(`turn ${String(index + 2)} reached it with the line, not the brief`,
      entry.text.includes('You were given standing instructions earlier in this conversation') && !entry.text.includes("Writing a teammate's name in your reply does NOT reach them"),
      `${String(entry.text.length)} characters`)
  }
  check('three turns, one session', turns.length === 3 && new Set(turns.map((entry) => entry.file)).size === 1, turns.map((entry) => entry.file).join(', '))
  check('turn two still sent Booty the message', two.peers.some((line) => /Booty/.test(line)), two.peers.join(' | '))
  // And not itself among them: the first packaged run of this drive had
  // Wren answer "my teammates are Wren (Code & Migrations) and Booty".
  check('turn three still knows its role and its teammate, and that it is not its own teammate',
    /code|migration/i.test(three.last) && /Booty/.test(three.last) && !/teammates?\b[^.]*\bWren\b/i.test(three.last),
    three.last.slice(0, 200))
  const record = JSON.parse(await readFile(join(profilePath, 'brief-sessions.json'), 'utf8').catch(() => '{}'))
  const counts = Object.values(record.sessions ?? {}).map((entry) => entry.turns)
  check('the host recorded turns 0, 1 and 2 of one session', counts.join(',') === '0,1,2', counts.join(','))
  say(failures === 0 ? '\nBRIEF ONCE PASSED' : `\nBRIEF ONCE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Booty on ${ON_CODEX ? 'Codex gpt-5.6-luna, low effort' : 'Claude Haiku'} (Ask), memory on, replies off; three turns in one conversation with Wren.` })
}
