// Locust's permission bridge: the one MCP tool Claude Code asks before using
// a connector.
//
// Claude Code is launched with `--permission-prompt-tool mcp__locust__approve`
// and an `--mcp-config` naming THIS file as a stdio server. When a run wants
// to call a connector tool and nothing has pre-approved it, the CLI calls
// `approve` here with `{tool_name, input, tool_use_id}` and waits. This
// script forwards that question to the Locust window over loopback HTTP,
// carrying a token minted for this one run, and answers with what the person
// chose: `{"behavior":"allow","updatedInput":…}` or
// `{"behavior":"deny","message":…}`. The message reaches the model verbatim
// -- measured 2026-09-10, "BLOCKED: Colin said no: …" came back word for
// word.
//
// It is deliberately tiny and dependency-free: it is spawned by a CLI that is
// not ours, in a folder that is not ours, and the less it does the less can
// go wrong somewhere we cannot see. It holds no state, decides nothing, and
// cannot answer without Locust: if the window is gone, the request fails and
// the CLI treats it as a denial, which is the safe direction.
//
// Ships beside app.asar via extraResources (electron-builder.yml).

import { request as httpRequest } from 'node:http'

const URL = process.env.LOCUST_PERMISSION_URL
const TOKEN = process.env.LOCUST_PERMISSION_TOKEN
const TOOL = {
  name: 'approve',
  description: 'Ask the person using Locust whether this tool call may proceed.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' }
    },
    required: ['tool_name']
  }
}

const send = (message) => {
  process.stdout.write(JSON.stringify(message) + '\n')
}

/** The deny that goes out when nobody can be asked. */
const nobodyHome = (why) => ({ behavior: 'deny', message: `Locust could not ask you: ${why}` })

const askLocust = (params) =>
  new Promise((resolve) => {
    if (URL === undefined || TOKEN === undefined) {
      resolve(nobodyHome('this run was started without a permission bridge.'))
      return
    }
    const body = JSON.stringify({ token: TOKEN, ...params })
    let target
    try {
      target = new globalThis.URL(URL)
    } catch {
      resolve(nobodyHome('the bridge address is malformed.'))
      return
    }
    const req = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        // Long, because a person may be away from the screen. The CLI has its
        // own patience; this must not run out first.
        timeout: 10 * 60 * 1000
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve(answer.behavior === 'allow' ? answer : { behavior: 'deny', message: answer.message ?? 'Denied in Locust.' })
          } catch {
            resolve(nobodyHome('its answer could not be read.'))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(nobodyHome('nobody answered in time.'))
    })
    req.on('error', () => resolve(nobodyHome('the window is not reachable.')))
    req.end(body)
  })

let buffer = ''
// Decoded across reads, not chunk by chunk: a character split between two
// reads became two replacement characters on the card (L11).
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += String(chunk)
  let cut
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (line.length === 0) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'locust', version: '1' }
        }
      })
      continue
    }
    if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools: [TOOL] } })
      continue
    }
    if (message.method === 'tools/call') {
      const params = message.params ?? {}
      const args = params.arguments ?? {}
      void askLocust({
        toolName: typeof args.tool_name === 'string' ? args.tool_name : 'a tool',
        input: args.input ?? {},
        toolUseId: typeof args.tool_use_id === 'string' ? args.tool_use_id : undefined
      }).then((answer) => {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: JSON.stringify(answer) }] }
        })
      })
      continue
    }
    if (typeof message.id === 'number' || typeof message.id === 'string') {
      send({ jsonrpc: '2.0', id: message.id, result: {} })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
