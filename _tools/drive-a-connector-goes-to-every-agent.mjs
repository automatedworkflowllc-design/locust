// One connector, added to every agent you choose (0.716).
//
//   node _tools/drive-a-connector-goes-to-every-agent.mjs
//   ... --packaged apps/desktop/release/win-unpacked/Locust.exe      (the installed app)
//
// Colin, 2026-10-09, of REA (an MCP server): "sure you can run connectors, or
// however you see fit." Settings > Connectors > Add a connector runs each
// agent's own `mcp add`. This drive fills that form in the running app with
// every agent's home pointed at a THROWAWAY folder -- HOME, USERPROFILE,
// XDG_CONFIG_HOME, CLAUDE_CONFIG_DIR and CODEX_HOME -- and reads each agent's
// own file back. Colin's real configs are checked for the names before and
// after, and must not change.
//
// The connector is a stand-in written here, a twenty-line MCP server, so
// nothing is downloaded and nothing third-party runs: started by an agent's
// listing it answers `initialize` and `tools/list` like any other.
//
// Checked, in order:
//   1. a command connector lands in each installed agent's own file, in its
//      own format, with the server's own flags (-y --quiet) kept;
//   2. an agent that already had one by that name (Codex, seeded) keeps it
//      as it was, and says so;
//   3. the connector list above reads Claude Code again and shows it working;
//   4. Undo takes it out of every agent it went to, except OpenCode, which
//      has no remove command and says where its copy is;
//   5. a web-address connector lands in each file as each spells one;
//   6. nothing changed in the real home.
//
// Spends nothing: no agent turn is sent.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')

// --- the throwaway home every agent is pointed at ---------------------------
const fake = await mkdtemp(join(tmpdir(), 'locust-drive-connector-home-'))
const HOME = join(fake, 'home')
const CLAUDE = join(fake, 'claude')
const CODEX = join(fake, 'codex')
await mkdir(join(HOME, '.config'), { recursive: true })
// Windows reads its known folders through USERPROFILE: Electron would not start without Documents.
for (const folder of ['Documents', 'Desktop', 'Downloads', join('AppData', 'Roaming'), join('AppData', 'Local')]) await mkdir(join(HOME, folder), { recursive: true })
await mkdir(CLAUDE, { recursive: true })
await mkdir(CODEX, { recursive: true })
// Codex already has one called rea: it must keep it.
const CODEX_KEPT = '[mcp_servers.rea]\ncommand = "keep-me"\nargs = []\n'
await writeFile(join(CODEX, 'config.toml'), CODEX_KEPT, 'utf8')

// --- the stand-in server, in a folder with a space in its name --------------
const serverDir = join(await mkdtemp(join(tmpdir(), 'locust-drive-connector-server-')), 'stand in')
await mkdir(serverDir, { recursive: true })
const SERVER = join(serverDir, 'server.mjs').replace(/\\/g, '/')
await writeFile(
  SERVER,
  [
    "import { createInterface } from 'node:readline'",
    'const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n")',
    "createInterface({ input: process.stdin }).on('line', (line) => {",
    '  let message',
    '  try { message = JSON.parse(line) } catch { return }',
    '  if (message.id === undefined) return',
    "  const answer = (result) => send({ jsonrpc: '2.0', id: message.id, result })",
    "  if (message.method === 'initialize') answer({ protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'locust-drive-stand-in', version: '1.0.0' } })",
    "  else if (message.method === 'tools/list') answer({ tools: [{ name: 'echo', description: 'Says back what it is given.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] })",
    "  else if (message.method === 'tools/call') answer({ content: [{ type: 'text', text: String(message.params?.arguments?.text ?? '') }] })",
    "  else if (message.method === 'ping') answer({})",
    "  else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })",
    "}).on('close', () => process.exit(0))",
    ''
  ].join('\n'),
  'utf8'
)
const TYPED_COMMAND = `node "${SERVER}" -y --quiet`
const ARGS = [SERVER, '-y', '--quiet']
const URL_ADDRESS = 'http://127.0.0.1:9/mcp'

// --- each agent's own file, read the way its own command wrote it -----------
const json = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}
const FILES = {
  claude: async (name) => (await json(join(CLAUDE, '.claude.json')))?.mcpServers?.[name],
  codex: async (name) => {
    const text = await readFile(join(CODEX, 'config.toml'), 'utf8').catch(() => '')
    const at = text.indexOf(`[mcp_servers.${name}]`)
    if (at < 0) return undefined
    const block = text.slice(at).split(/\n(?=\[)/)[0]
    return block
  },
  gemini: async (name) => (await json(join(HOME, '.gemini', 'settings.json')))?.mcpServers?.[name],
  copilot: async (name) => (await json(join(HOME, '.copilot', 'mcp-config.json')))?.mcpServers?.[name],
  opencode: async (name) => ((await json(join(HOME, '.config', 'opencode', 'opencode.jsonc'))) ?? (await json(join(HOME, '.config', 'opencode', 'opencode.json'))))?.mcp?.[name],
  antigravity: async (name) => (await json(join(HOME, '.gemini', 'config', 'mcp_config.json')))?.mcpServers?.[name]
}
const NAMES = { claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI', copilot: 'Copilot CLI', opencode: 'OpenCode', antigravity: 'Antigravity' }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const COMMAND_SHAPE = {
  claude: (entry) => entry?.type === 'stdio' && entry.command === 'node' && same(entry.args, ARGS),
  gemini: (entry) => entry?.command === 'node' && same(entry.args, ARGS),
  copilot: (entry) => entry?.command === 'node' && same(entry.args, ARGS),
  opencode: (entry) => entry?.type === 'local' && same(entry.command, ['node', ...ARGS]),
  antigravity: (entry) => entry?.command === 'node' && same(entry.args, ARGS)
}
const URL_SHAPE = {
  claude: (entry) => entry?.type === 'http' && entry.url === URL_ADDRESS,
  codex: (block) => typeof block === 'string' && block.includes(`url = "${URL_ADDRESS}"`),
  gemini: (entry) => entry?.url === URL_ADDRESS,
  copilot: (entry) => entry?.url === URL_ADDRESS,
  opencode: (entry) => entry?.type === 'remote' && entry.url === URL_ADDRESS,
  antigravity: (entry) => entry?.serverUrl === URL_ADDRESS || entry?.url === URL_ADDRESS
}

// --- the real home: these names, present or not, before and after -----------
const REAL = [
  join(homedir(), '.claude.json'),
  join(homedir(), '.codex', 'config.toml'),
  join(homedir(), '.gemini', 'settings.json'),
  join(homedir(), '.copilot', 'mcp-config.json'),
  join(homedir(), '.config', 'opencode', 'opencode.json'),
  join(homedir(), '.config', 'opencode', 'opencode.jsonc'),
  join(homedir(), '.gemini', 'config', 'mcp_config.json')
]
/** Only whether each file names `rea` or `docs` as a server -- nothing of it is printed or kept. */
const realHome = async () =>
  Promise.all(
    REAL.map(async (path) => {
      const text = await readFile(path, 'utf8').catch(() => '')
      return `${path}: ${['rea', 'docs'].map((name) => (new RegExp(`"${name}"\\s*:|\\[mcp_servers\\.${name}\\]`).test(text) ? `${name} yes` : `${name} no`)).join(', ')}`
    })
  )
const realBefore = await realHome()

const workspace = await scratchRepository('locust-drive-connector-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-connector-goes-to-every-agent${packaged === undefined ? '' : '-packaged'}`,
  port: 9883,
  workspace,
  sendsNothing: true,
  env: { HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: join(HOME, '.config'), CLAUDE_CONFIG_DIR: CLAUDE, CODEX_HOME: CODEX },
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed, detail })
  say(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` -- ${detail}`}`)
}

/** The rows Add a connector drew, as { agent name: { state, detail } }. */
const rowsScript = `(() => JSON.stringify(Object.fromEntries([...document.querySelectorAll('.lc-addconnector__results .lc-connectorhealth__row')].map((row) => [
  row.querySelector('.lc-addconnector__who')?.innerText.trim(),
  { state: row.querySelector('.lc-connectorhealth__state')?.textContent.trim(), detail: row.querySelector('.lc-connectorhealth__detail')?.textContent.trim() }
]))))()`
const fill = (values) => `(async () => {
  const form = document.querySelector('.lc-addconnector__form')
  if (!form) return 'no form'
  const put = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  ${values.kind === 'url' ? `[...form.querySelectorAll('[role="radio"]')].find((b) => /web address/i.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 200))` : ''}
  const inputs = form.querySelectorAll('input')
  put(inputs[0], ${JSON.stringify(values.name)})
  put(inputs[1], ${JSON.stringify(values.value)})
  await new Promise((r) => setTimeout(r, 200))
  const agents = [...form.querySelectorAll('.lc-addconnector__agent')].map((b) => b.innerText.trim() + (b.getAttribute('aria-pressed') === 'true' ? '' : ' (off)'))
  return JSON.stringify({ agents, button: form.querySelector('button[type="submit"]')?.innerText.trim() })
})()`
const press = (pattern) => `(() => {
  const button = [...document.querySelectorAll('.lc-addconnector button')].find((b) => ${pattern}.test(b.innerText) && !b.disabled)
  if (!button) return 'no button ' + ${JSON.stringify(String(pattern))}
  button.click()
  return button.innerText.trim()
})()`
const settled = `(() => { const r = document.querySelector('.lc-addconnector__results'); const busy = [...document.querySelectorAll('.lc-addconnector button')].some((b) => /Adding…|Taking it back…/.test(b.innerText)); return r && !busy ? r.innerText.length : false })()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open Settings > Connectors', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const item = [...document.querySelectorAll('.lc-settings__navitem')].find(n => n.innerText.trim().startsWith('Connectors'))
    if (!item) return 'no Connectors page'
    item.click()
    await new Promise(r => setTimeout(r, 700))
    return [...document.querySelectorAll('.lc-settings__pane .lc-settings__heading')].map(h => h.innerText.trim()).join(' | ')
  })()`))
  // The agents are found in the background: the button opens once one that can take a connector is.
  await drive.waitFor(`(() => { const b = [...document.querySelectorAll('.lc-addconnector__start button')].find(b => /Add a connector/.test(b.innerText)); return b && !b.disabled })()`, { timeoutMs: 90_000, what: 'Add a connector to open' })
  await drive.capture('scroll to Add a connector, and open it', () => drive.evaluate(`(async () => {
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => h.innerText.trim() === 'Add a connector')
    heading?.scrollIntoView({ block: 'start' })
    const pressed = ${press('/Add a connector/')}
    await new Promise(r => setTimeout(r, 300))
    return document.querySelector('.lc-addconnector__form') ? 'the form is open' : 'NO FORM: ' + pressed
  })()`))

  // 1-2. A command connector.
  const filled = JSON.parse(String(await drive.capture('the form, filled: a command', () => drive.evaluate(fill({ name: 'rea', kind: 'command', value: TYPED_COMMAND })))))
  const offered = Object.entries(NAMES).filter(([, name]) => filled.agents.some((chip) => chip === name)).map(([agent]) => agent)
  // The form at a laptop's size and a small window's: one agent turned off and on again, to see both.
  const measure = `(() => {
    const form = document.querySelector('.lc-addconnector__form')
    form?.scrollIntoView({ block: 'center' })
    const box = (el) => el?.getBoundingClientRect()
    const name = box(form?.querySelector('input')), runs = box(form?.querySelector('.lc-segmented'))
    return JSON.stringify({ wide: Math.round(box(form)?.width ?? 0), overflow: form ? form.scrollWidth > form.clientWidth : 'no form', nameBox: name && [Math.round(name.top), Math.round(name.height)], switchBox: runs && [Math.round(runs.top), Math.round(runs.height)] })
  })()`
  for (const [width, height] of [[1366, 768], [960, 700]]) {
    await drive.resize(width, height)
    await drive.capture(`the form at ${String(width)}x${String(height)}, Codex turned off`, () => drive.evaluate(`(async () => {
      [...document.querySelectorAll('.lc-addconnector__agent')].find((b) => /Codex/.test(b.innerText))?.click()
      await new Promise((r) => setTimeout(r, 200))
      return ${measure} + ' ' + document.querySelector('.lc-addconnector__form button[type="submit"]')?.innerText
    })()`))
    const sizes = JSON.parse(String(await drive.evaluate(measure)))
    check(`at ${String(width)}x${String(height)} the form fits, and the switch stands level with the Name box`, sizes.overflow === false && sizes.nameBox?.[0] === sizes.switchBox?.[0] && sizes.nameBox?.[1] === sizes.switchBox?.[1], JSON.stringify(sizes))
    await drive.evaluate(`[...document.querySelectorAll('.lc-addconnector__agent')].find((b) => /Codex/.test(b.innerText))?.click()`)
  }
  await drive.resize(1215, 800)
  check('every installed agent that can take one is offered, all chosen', offered.length > 0 && filled.agents.every((chip) => !chip.endsWith('(off)')), filled.agents.join(', '))
  await drive.capture('Add', () => drive.evaluate(press('/^Add to /')))
  await drive.waitFor(settled, { timeoutMs: 150_000, what: 'what each agent said' })
  const added = JSON.parse(await drive.capture('what each agent said', () => drive.evaluate(rowsScript)))
  say(JSON.stringify(added))
  for (const agent of offered) {
    const row = added[NAMES[agent]]
    if (agent === 'codex') {
      check('Codex already had one called rea: it says so, and its own is kept as it was', row?.state === 'Had one' && (await readFile(join(CODEX, 'config.toml'), 'utf8')) === CODEX_KEPT, row?.state)
      continue
    }
    const entry = await FILES[agent]('rea')
    check(`${NAMES[agent]} has it, in its own file, with the server's own flags kept`, row?.state === 'Added' && COMMAND_SHAPE[agent](entry), `${row?.state ?? 'no row'}; ${JSON.stringify(entry)}`)
  }

  // 3. The list above reads Claude Code again, and the stand-in works when Claude Code starts it.
  if (offered.includes('claude')) {
    const state = await drive.waitFor(`(() => { const row = [...document.querySelectorAll('.lc-connectorhealth > .lc-connectorhealth__list .lc-connectorhealth__row')].find(r => r.querySelector('.lc-connectorhealth__name')?.innerText.trim() === 'rea'); return row ? row.querySelector('.lc-connectorhealth__state')?.innerText.trim() : false })()`, { timeoutMs: 90_000, what: 'rea in the connector list' }).catch((error) => String(error.message))
    await drive.capture('the connector list, read again', () => drive.evaluate(`(() => { document.querySelector('.lc-connectorhealth')?.scrollIntoView({ block: 'start' }); return document.querySelector('.lc-connectorhealth')?.innerText.slice(0, 300) })()`))
    check('the connector list above reads Claude Code again and shows it working', /connected/i.test(String(state)), String(state))
  }

  // 4. Undo.
  await drive.capture('Undo', () => drive.evaluate(`(() => { document.querySelector('.lc-addconnector__results')?.scrollIntoView({ block: 'center' }); return ${press('/^Undo$/')} })()`))
  await drive.waitFor(settled, { timeoutMs: 120_000, what: 'Undo to finish' })
  const undone = JSON.parse(await drive.capture('what Undo did', () => drive.evaluate(rowsScript)))
  say(JSON.stringify(undone))
  for (const agent of offered) {
    const row = undone[NAMES[agent]]
    const entry = await FILES[agent]('rea')
    if (agent === 'codex') check('Undo left Codex’s own rea alone', row?.state === 'Had one' && (await readFile(join(CODEX, 'config.toml'), 'utf8')) === CODEX_KEPT, row?.state)
    else if (agent === 'opencode') check('OpenCode, which has no remove command, keeps it and says where', row?.state === 'Still has it' && /opencode\.json/.test(row?.detail ?? '') && entry !== undefined, row?.detail)
    else check(`Undo took it out of ${NAMES[agent]}`, row?.state === 'Taken back' && entry === undefined, `${row?.state ?? 'no row'}; ${JSON.stringify(entry)}`)
  }

  // 5. A web address.
  await drive.capture('Add another…', () => drive.evaluate(`(async () => { const said = ${press('/Add another/')}; await new Promise(r => setTimeout(r, 300)); return said })()`))
  await drive.capture('the form, filled: a web address', () => drive.evaluate(fill({ name: 'docs', kind: 'url', value: URL_ADDRESS })))
  await drive.capture('Add the web address', () => drive.evaluate(press('/^Add to /')))
  await drive.waitFor(settled, { timeoutMs: 150_000, what: 'what each agent said of the address' })
  const web = JSON.parse(await drive.capture('what each agent said of the address', () => drive.evaluate(rowsScript)))
  say(JSON.stringify(web))
  for (const agent of [...offered]) {
    const row = web[NAMES[agent]]
    const entry = await FILES[agent]('docs')
    check(`${NAMES[agent]} has the address, as it spells one`, row?.state === 'Added' && URL_SHAPE[agent](entry), `${row?.state ?? 'no row'}; ${JSON.stringify(entry)}`)
  }
  await drive.capture('the page, after', () => drive.evaluate(`(() => { document.querySelector('.lc-addconnector')?.scrollIntoView({ block: 'start' }); return document.querySelector('.lc-addconnector')?.innerText.slice(0, 400) })()`))
} catch (error) {
  check('the drive ran to the end', false, String(error?.stack ?? error))
} finally {
  await sleep(500)
  // 6. The real home.
  const realAfter = await realHome()
  check('nothing changed in the real home', same(realBefore, realAfter), realAfter.filter((line, at) => line !== realBefore[at]).join(' ; ') || 'the same')
  const failed = results.filter((one) => !one.passed)
  await drive.finish({
    intro: 'One connector, added to every agent chosen, in a throwaway home (0.716). Spends nothing.',
    extra: [
      `${String(results.length - failed.length)}/${String(results.length)} checks passed.`,
      '',
      ...results.map((one) => `- ${one.passed ? 'PASS' : 'FAIL'} ${one.name}${one.detail === undefined ? '' : ` -- ${String(one.detail).slice(0, 300)}`}`),
      '',
      `Throwaway home: ${fake}`
    ].join('\n')
  })
  process.exitCode = failed.length === 0 ? 0 : 1
}
