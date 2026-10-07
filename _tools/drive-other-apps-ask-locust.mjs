// Another AI app asks a Locust teammate through Locust's MCP server (0.691), end to end.
//
//   LOCUST_SPEND=1 node _tools/drive-other-apps-ask-locust.mjs [--packaged <exe>]
//
// A throwaway profile with one teammate on the free model. The drive turns the real switch on in
// Settings > General, reads the setup line the switch shows, and points a REAL Claude Code at it with a
// one-off config (`--mcp-config ... --strict-mcp-config`), so the person's own Claude Code settings are
// never touched. Claude Code (Haiku, the cheapest that answers) lists the teammates and starts a
// conversation; the drive then reads the reply through the bridge itself, checks the conversation is in
// Locust's history marked as started from another app, in Ask mode, and that turning the switch off
// leaves the bridge refused.
//
// Spends: one short Haiku turn on Colin's Claude account. The teammate's own turn is on the free model.
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FREE_ROUTE, say, startDrive } from './drive-lib.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = join(root, '.tmp', 'other-apps-drive')
await mkdir(scratch, { recursive: true })
const workspace = await mkdtemp(join(scratch, 'workspace-'))
const profile = await mkdtemp(join(scratch, 'profile-'))
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined

const drive = await startDrive({
  name: 'other-apps-ask-locust', port: 9561, workspace, profilePath: profile, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  outPath: join(scratch, new Date().toISOString().replace(/[:.]/g, '-')),
  focused: true,
  seed: { schemaVersion: 1,
    // Wren usually WRITES (accept-edits): the server must still start her in Ask.
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-07T00:00:00Z', route: FREE_ROUTE }],
    missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
let checks = 0
const check = (what, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` -- ${detail}` : ''}`)
}
const wait = async (expression, seconds = 30) => {
  for (let i = 0; i < seconds * 4; i += 1) {
    if (await drive.evaluate(expression)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${expression}`)
}

/** The bridge, spoken to directly over stdio: one JSON-RPC request, one answer. */
function bridgeCall(setup, name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(setup.node, [setup.bridge, setup.connection], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      const line = out.split('\n').find((part) => part.includes('"id":7'))
      if (line !== undefined) { child.kill(); resolve(JSON.parse(line).result) }
    })
    child.on('error', reject)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    setTimeout(() => { child.kill(); reject(new Error(`bridge: no answer to ${name}`)) }, 90_000)
  })
}
const textOf = (result) => result?.content?.map((part) => part.text).join('') ?? ''

try {
  await drive.ready()
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Settings/.test(b.innerText))?.click()`)
  await wait(`!!document.querySelector('[aria-label="Let your other AI apps use Locust"]:not(:disabled)')`)
  check('the switch starts off, with no server', await drive.evaluate(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').getAttribute('aria-checked') === 'false'`))
  await drive.evaluate(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').click()`)
  await wait(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').getAttribute('aria-checked') === 'true' && document.querySelectorAll('.lc-mcp-setup').length === 2`)
  const shown = await drive.capture('Settings > General: the switch on, with the setup lines', () => drive.evaluate(`[...document.querySelectorAll('.lc-mcp-setup')].map(p => p.innerText)`))
  // The Codex block is TOML whose strings are JSON strings: the three paths, exactly.
  const codex = shown[1]
  const command = JSON.parse(codex.match(/command = (".*")/)[1])
  const args = JSON.parse(codex.match(/args = (\[.*\])/)[1])
  const setup = { node: command, bridge: args[0], connection: args[1] }
  check('the setup names this Locust, its bridge and the connection file, and no token', /locust-mcp-bridge\.mjs$/.test(setup.bridge) && /locust-mcp-connection\.json$/.test(setup.connection) && !/[0-9a-f]{64}/.test(shown.join('\n')), JSON.stringify(setup))
  // Present, never pressed: a press would write over the person's own clipboard.
  const copies = await drive.evaluate(`[...document.querySelectorAll('.lc-mcp-setup__copy')].map(b => b.getAttribute('aria-label'))`)
  check('each setup line has its own Copy', copies.length === 2 && copies[0] === 'Copy the Claude Code command' && copies[1] === 'Copy the Codex settings', copies.join(' | '))

  // A REAL client: Claude Code, one-off config, its own settings untouched.
  const config = join(scratch, `mcp-${String(Date.now())}.json`)
  await writeFile(config, JSON.stringify({ mcpServers: { locust: { command: setup.node, args: [setup.bridge, setup.connection], env: { ELECTRON_RUN_AS_NODE: '1' } } } }))
  const prompt = 'Use the locust tools. First call list_teammates. Then call start_conversation with teammate "Wren" and message "Reply with the single word PONG and nothing else." Then answer with the JSON the start_conversation tool returned, and nothing else.'
  // The prompt goes in on stdin: through the shell the claude shim needs, an argument is cut at its first space.
  const claude = await new Promise((resolve) => {
    const child = execFile('claude', ['-p', '--mcp-config', `"${config}"`, '--strict-mcp-config', '--model', 'haiku',
      '--allowedTools', 'mcp__locust__list_teammates,mcp__locust__start_conversation', '--output-format', 'json'],
    { cwd: workspace, shell: true, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }))
    child.stdin.end(prompt)
  })
  let answer
  try { answer = JSON.parse(claude.stdout) } catch { answer = undefined }
  say(`claude: ${String(answer?.result ?? claude.stderr).slice(0, 300)}`)
  const conversation = String(answer?.result ?? '').match(/mission_[0-9a-f-]{36}/)?.[0]
  check('a real Claude Code started a conversation through the server', conversation !== undefined && /"mode"\s*:\s*"ask"/.test(String(answer?.result)), String(answer?.result).slice(0, 200))
  if (conversation === undefined) throw new Error('no conversation to follow')

  // Read the reply the way any client would, until the teammate's turn ends.
  let reply = ''
  for (let i = 0; i < 60; i += 1) {
    reply = textOf(await bridgeCall(setup, 'read_reply', { conversation_id: conversation }))
    if (!/^Still working/.test(reply)) break
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  check('read_reply brings the teammate\'s answer back', /PONG/i.test(reply), reply.slice(0, 200))

  const record = await drive.evaluate(`window.desktop.getMissionHistory().then(h => h.ok ? h.data.missions.map(m => ({ id: m.missionId, mode: m.mode, startedBy: m.startedBy?.kind })) : [])`)
  const mine = record.find((row) => row.id === conversation)
  check('the conversation is in Locust\'s history, from another app, in Ask', mine !== undefined && mine.startedBy === 'mcp' && mine.mode === 'ask', JSON.stringify(mine))
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Conversations|Home/.test(b.innerText))?.click()`)
  await wait(`[...document.querySelectorAll('.lc-conv')].length > 0`)
  await drive.evaluate(`[...document.querySelectorAll('.lc-conv')][0].click()`)
  try { await wait(`/Started from another app/i.test(document.querySelector('.lc-thread')?.innerText ?? '')`, 20) } catch {
    say(`rows: ${await drive.evaluate(`[...document.querySelectorAll('.lc-conv')].map(r => r.getAttribute('title') ?? r.innerText.slice(0, 60)).join(' || ')`)}`)
    say(`thread: ${await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? 'no thread').slice(0, 400)`)}`)
  }
  const marker = await drive.capture('the conversation, marked as started from another app', () => drive.evaluate(`[...document.querySelectorAll('.lc-thread__marker')].map(m => m.innerText).join(' | ')`))
  check('the thread says it was started from another app, read only', /Started from another app · Ask mode \(read only\)/i.test(marker), marker)

  // Off: the bridge is refused, and nothing is left listening.
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Settings/.test(b.innerText))?.click()`)
  await wait(`!!document.querySelector('[aria-label="Let your other AI apps use Locust"]:not(:disabled)')`)
  await drive.evaluate(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').click()`)
  await wait(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').getAttribute('aria-checked') === 'false'`)
  const after = textOf(await bridgeCall(setup, 'list_teammates', {}))
  check('switched off, the bridge says Locust is not running', /Locust is not running/.test(after), after)
  await drive.capture('the switch off again', () => drive.evaluate(`document.querySelector('[data-setting="locust-mcp"]').innerText`))
  const errors = drive.record.flatMap((step) => step.errors)
  check('no renderer errors were captured', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`[FAIL] the drive stopped: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Another AI app (a real Claude Code, Haiku, one-off config) asks a Locust teammate through the MCP server.' })
  say(failures === 0 ? `${String(checks)} / ${String(checks)} CHECKS PASSED` : `${String(failures)} of ${String(checks)} checks FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}
