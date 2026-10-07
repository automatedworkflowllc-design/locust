// A dependency-free stdio MCP server, spawned by the person's other AI app.
// It never launches Locust, writes another app's config, or follows redirects.
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'

const NOT_RUNNING = 'Locust is not running. Open it and try again.'
const result = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string', minLength: 1, maxLength: 200 }
const message = { type: 'string', minLength: 1, maxLength: 8000 }
const TOOLS = [
  { name: 'list_teammates', description: 'List Locust teammates: id, name, role, runtime, model and whether busy. Read only.', inputSchema: schema() },
  { name: 'start_conversation', description: 'Ask a Locust teammate by name or id. Always Ask mode (read only), regardless of its usual mode, with no automatic teammate handoffs. Shares remain visible in Locust. API/account usage and Locust monthly limits apply. Returns a conversation id; use read_reply to poll.', inputSchema: schema({ teammate: string, message }, ['teammate', 'message']) },
  { name: 'send_message', description: 'Continue a conversation started by this server. Always Ask mode (read only), with no automatic teammate handoffs. No message is queued while it is working; poll read_reply before sending.', inputSchema: schema({ conversation_id: string, message }, ['conversation_id', 'message']) },
  { name: 'read_reply', description: 'Read the newest finished answer, current activity while still working, or Locust\'s own failure words. Read only.', inputSchema: schema({ conversation_id: string }, ['conversation_id']) },
  { name: 'list_background_runs', description: 'List Claude turns running in the background. Read only; never starts or stops them.', inputSchema: schema() }
]

async function call(name, args) {
  let connection
  try {
    connection = JSON.parse(await readFile(process.argv[2], 'utf8'))
    const url = new URL(connection.url)
    // A profile file can never redirect this bearer token off the machine.
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/tools/call' || url.search || url.hash || url.username || url.password || !url.port || !/^[0-9a-f]{64}$/.test(connection.token)) throw new Error('invalid')
  } catch { return result(NOT_RUNNING, true) }
  return new Promise(resolve => {
    const payload = JSON.stringify({ name, arguments: args })
    const req = request(connection.url, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, timeout: 60_000 }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(result(res.statusCode === 401 ? 'Locust refused this connection. Check the switch in Settings > General and try again.' : 'Locust could not complete that request. Nothing was retried.', true))
        return
      }
      const chunks = []
      let size = 0
      res.on('data', chunk => { size += chunk.length; if (size <= 5 * 1024 * 1024) chunks.push(chunk); else res.destroy() })
      res.on('error', () => resolve(result('Locust\'s answer could not be read. Nothing was retried.', true)))
      res.on('end', () => {
        try {
          const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(Array.isArray(answer.content) ? answer : result('Locust\'s answer could not be read. Nothing was retried.', true))
        } catch { resolve(result('Locust\'s answer could not be read. Nothing was retried.', true)) }
      })
    })
    req.on('timeout', () => { req.destroy(); resolve(result('Locust did not answer in time. Nothing was retried; check its history before starting again.', true)) })
    req.on('error', error => resolve(result(error.code === 'ECONNREFUSED' ? NOT_RUNNING : 'The connection to Locust ended without an answer. Nothing was retried; check its history before starting again.', true)))
    req.end(payload)
  })
}

const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
const error = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  if (Buffer.byteLength(buffer) > 256 * 1024) { error(null, -32600, 'MCP request is too large. Nothing was started.'); process.exitCode = 1; process.stdin.destroy(); return }
  let cut
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1)
    if (!line) continue
    let rpc
    try { rpc = JSON.parse(line) } catch { error(null, -32700, 'Invalid JSON'); continue }
    if (typeof rpc !== 'object' || rpc === null || rpc.jsonrpc !== '2.0') { error(null, -32600, 'Invalid request'); continue }
    if (rpc.id === undefined) continue // notifications have no response
    if (rpc.method === 'initialize') { send(rpc.id, { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(rpc.params?.protocolVersion) ? rpc.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'locust', version: '1' } }); continue }
    if (rpc.method === 'ping') { send(rpc.id, {}); continue }
    if (rpc.method === 'tools/list') { send(rpc.id, { tools: TOOLS }); continue }
    if (rpc.method === 'tools/call') {
      if (!TOOLS.some(t => t.name === rpc.params?.name)) { error(rpc.id, -32602, 'Unknown Locust tool'); continue }
      void call(rpc.params.name, rpc.params.arguments ?? {}).then(answer => send(rpc.id, answer)).catch(() => send(rpc.id, result('Locust could not complete that request. Nothing was retried.', true)))
      continue
    }
    error(rpc.id, -32601, 'Method not found')
  }
})
