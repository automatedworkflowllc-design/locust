// A stand-in `claude` for measuring Locust's window while a reply streams (0.637).
//
// No model is asked and nothing is spent. Locust's discovery finds this first
// when a drive puts this folder first on the app's PATH
// (LOCUST_DRIVE_PATH_FIRST, see drive-lib.mjs). It answers the three things
// discovery asks -- `--version`, `--help`, `auth status` -- and any other
// command line is treated as a run: it prints Claude Code's stream-json, in
// the shapes recorded in packages/runtime-adapters/test/fixtures/claude/, with
// a long reply in small text deltas at a steady pace, then the result.
//
// Its version is "0.0.0-locust-fake": a drive must read that back from the
// app before it sends anything, so a real `claude` found first is never run.
//
//   FAKE_CLAUDE_WORDS     words in the reply (default 1800)
//   FAKE_CLAUDE_DELTA_MS  milliseconds between deltas (default 40)
//   FAKE_CLAUDE_PER_DELTA words per delta (default 2)
//   FAKE_CLAUDE_TOOL_CALLS harmless simulated Read calls before the reply (default 0)
//   FAKE_CLAUDE_TOOL_MS milliseconds between simulated calls (default 20)
import { randomUUID } from 'node:crypto'

export const FAKE_VERSION = '0.0.0-locust-fake'
const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${FAKE_VERSION} (Claude Code)\n`)
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: 'stand-in', apiProvider: 'none' })}\n`)
  process.exit(0)
}
if (args.includes('--help') || args.includes('-h')) {
  // Every flag Locust's feature scan looks for (runtime-adapters commands.ts).
  process.stdout.write([
    'Usage: claude [options] [command] [prompt]',
    '  -p, --print                      print the response and exit; the prompt may come on stdin',
    '  --output-format <format>         text, json or stream-json',
    '  --input-format <format>          text or stream-json',
    '  --include-partial-messages       stream partial messages',
    '  --verbose                        verbose output',
    '  --restricted                     restricted mode',
    '  --permission-mode <mode>         default, acceptEdits, plan, bypassPermissions',
    '  --permission-prompt-tool <tool>  MCP tool for permission prompts',
    '  --tools <tools...>               tools to allow',
    '  --disallowedTools <tools...>     tools to deny',
    '  --model <model>                  model',
    '  --resume <id>                    resume a session',
    ''
  ].join('\n'))
  process.exit(0)
}

// A run. Read its first input line; the pipe stays open for steer/approval messages.
// Runtime environment filtering intentionally excludes FAKE_CLAUDE_* variables,
// so the long-turn drive also selects its mode by a marker in the prompt.
const prompt = await new Promise((resolve) => {
  let input = ''
  let received = false
  process.stdin.on('data', (chunk) => {
    if (received) return
    input += chunk.toString()
    if (input.includes('\n')) { received = true; resolve(input) }
  })
  process.stdin.on('end', () => resolve(input))
})
process.stdin.on('error', () => undefined)

const words = Number(process.env.FAKE_CLAUDE_WORDS ?? '1800')
const deltaMs = Number(process.env.FAKE_CLAUDE_DELTA_MS ?? '40')
const perDelta = Number(process.env.FAKE_CLAUDE_PER_DELTA ?? '2')
const toolCalls = Number(process.env.FAKE_CLAUDE_TOOL_CALLS ?? (prompt.includes('[locust-fake-long-turn]') ? '600' : '0'))
const toolMs = Number(process.env.FAKE_CLAUDE_TOOL_MS ?? '20')
const modelAt = args.indexOf('--model')
const model = modelAt === -1 ? 'claude-haiku-4-5' : args[modelAt + 1] ?? 'claude-haiku-4-5'
const session = randomUUID()
const messageId = `msg_fake${randomUUID().replace(/-/g, '').slice(0, 20)}`
const line = (record) => process.stdout.write(`${JSON.stringify({ ...record, session_id: session, uuid: randomUUID() })}\n`)
const event = (inner) => line({ type: 'stream_event', event: inner, parent_tool_use_id: null })

const SENTENCES = [
  'The swarm rose from the edge of the field before the sun had cleared the hedge.',
  'Each locust caught the light for a moment and then was gone into the moving cloud.',
  'Below them the wheat leaned one way and then the other, as if the field were breathing.',
  'An old farmer watched from the gate and said nothing, because there was nothing to say.',
  'By noon the cloud had crossed the river, and its sound had become a kind of weather.'
]
const text = []
for (let i = 0; text.length < words; i += 1) text.push(...SENTENCES[i % SENTENCES.length].split(' '))
text.length = words
const pieces = []
for (let i = 0; i < text.length; i += perDelta) pieces.push(`${i === 0 ? '' : ' '}${text.slice(i, i + perDelta).join(' ')}${(i / perDelta) % 40 === 39 ? '\n\n' : ''}`)
const full = pieces.join('')

line({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Read', 'Glob', 'Grep'], mcp_servers: [], model, permissionMode: 'default', claude_code_version: FAKE_VERSION })
// These are receipts, not executed tools: no files are read or changed.
const wholeMessage = (id, content) => line({ type: 'assistant', message: { model, id, type: 'message', role: 'assistant', content, stop_reason: null }, parent_tool_use_id: null })
if (toolCalls > 0) {
  wholeMessage('opening', [{ type: 'text', text: 'I will read the sample files, then explain what I found.' }])
  for (let call = 1; call <= toolCalls; call += 1) {
    const id = `tool_fake_${call}`
    const input = { file_path: `sample-${call}.md` }
    event({ type: 'message_start', message: { model, id: `msg_tool_${call}`, type: 'message', role: 'assistant', content: [] } })
    event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'Read', input: {} } })
    event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
    event({ type: 'content_block_stop', index: 0 })
    wholeMessage(`msg_tool_${call}`, [{ type: 'tool_use', id, name: 'Read', input }])
    event({ type: 'message_stop' })
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Simulated sample contents.', is_error: false }] }, parent_tool_use_id: null })
    if (call % 40 === 0) wholeMessage(`progress_${call}`, [{ type: 'text', text: `I have checked ${call} sample files. The sample contents agree.` }])
    await new Promise((resolve) => setTimeout(resolve, toolMs))
  }
}
event({ type: 'message_start', message: { model, id: messageId, type: 'message', role: 'assistant', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })

let at = 0
const started = Date.now()
const tick = () => {
  if (at < pieces.length) {
    event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: pieces[at] } })
    at += 1
    setTimeout(tick, deltaMs)
    return
  }
  event({ type: 'content_block_stop', index: 0 })
  line({ type: 'assistant', message: { model, id: messageId, type: 'message', role: 'assistant', content: [{ type: 'text', text: full }], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: words } }, parent_tool_use_id: null })
  event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 10, output_tokens: words } })
  event({ type: 'message_stop' })
  const ms = Date.now() - started
  line({ type: 'result', subtype: 'success', is_error: false, duration_ms: ms, duration_api_ms: ms, num_turns: 1, result: full, stop_reason: 'end_turn', total_cost_usd: 0, usage: { input_tokens: 10, output_tokens: words } })
  process.exit(0)
}
setTimeout(tick, 300)
