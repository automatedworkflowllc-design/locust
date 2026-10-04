// What a rate-limited OpenCode run looks like through Locust's own path.
//
//   node _tools/probe-opencode-rate-limit.mjs [--refuse <n>]
//
// Free OpenCode models sat on "Starting" for minutes (Colin, 2026-09-25: "is
// this a locust issue or open code issue?"): the provider rate limits, and
// `opencode run` retries without printing anything until it gives up. This
// starts a local OpenAI-compatible endpoint that answers the first <n>
// requests 429 (default: all of them) and the rest with "pong", then runs
// Locust's OWN OpenCode command, process runner and normalizer against it and
// prints each event with its time.
//
// The one seam: the spec's OPENCODE_CONFIG_CONTENT gains a `fake` provider,
// because the app writes its own config there and adding a provider is not
// Locust's to do. Build the adapters first (pnpm -C packages/runtime-adapters
// build). Spends nothing; needs the internet only for whatever OpenCode
// fetches at start.

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const at = process.argv.indexOf('--refuse')
const refuse = at === -1 ? Number.POSITIVE_INFINITY : Number(process.argv[at + 1])

let requests = 0
const server = createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    requests += 1
    if (requests <= refuse) {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' })
      response.end(JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`)
    const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'fake' }
    chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'pong' }, finish_reason: null }] })
    chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })
    response.end('data: [DONE]\n\n')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const lib = await import(new URL('../packages/runtime-adapters/dist/index.js', import.meta.url).href)
// The npm install puts a shim on PATH and the real binary here.
const installed = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
let where = installed
try {
  where = execFileSync('where', ['opencode.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).find((line) => line.trim().length > 0) ?? installed
} catch {
  // Not on PATH as an .exe: the npm install's copy.
}
const workspace = mkdtempSync(join(tmpdir(), 'locust-ratelimit-ws-'))
const spec = lib.createOpenCodeRunCommand(
  { executablePath: where.trim(), prefixArgs: [] },
  { workspacePath: workspace, prompt: 'say pong', model: 'fake/fake', sandbox: 'workspace-write' }
)
const config = JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}')
config.provider = { fake: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${String(port)}/v1`, apiKey: 'x' }, models: { fake: { name: 'fake' } } } }
const seamed = { ...spec, env: { ...spec.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } }
console.log(`argv: ${seamed.args.join(' ')}`)

const started = Date.now()
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1)}s`
const run = lib.createNodeRuntimeProcessRunner().start(seamed, 'say pong')
const normalizer = lib.createOpenCodeEventNormalizer({ runId: 'run_1', missionId: 'mission_1', cliVersion: 'probe' })
const said = (event) => (event.type === 'adapter.diagnostic' ? ` ${event.payload.level} ${event.payload.code}: ${event.payload.message}` : event.type === 'run.failed' ? ` ${event.payload.message}` : '')
for await (const record of run.records) for (const event of normalizer.accept(record)) console.log(`${stamp()} ${event.type}${said(event)}`)
const completion = await run.completion
for (const event of normalizer.finish(completion)) console.log(`${stamp()} ${event.type}${said(event)}`)
console.log(`exit ${String(completion.exitCode)}; the endpoint was asked ${String(requests)} time(s)`)
server.close()
rmSync(workspace, { recursive: true, force: true })
