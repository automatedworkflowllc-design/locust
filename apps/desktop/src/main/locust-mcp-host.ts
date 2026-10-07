import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { LocustMcpState } from '../shared/locust-mcp.js'

export const MCP_CONNECTION_FILE = 'locust-mcp-connection.json'
export const MCP_SETTINGS_FILE = 'locust-mcp.json'
export type McpToolResult = { readonly content: readonly { readonly type: 'text'; readonly text: string }[]; readonly isError?: boolean }
export const mcpText = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })

/** The setup carries a file path, never the bearer token or a changing port. */
export function mcpSetup(node: string, bridge: string, connection: string): Pick<LocustMcpState, 'claudeCommand' | 'codexConfig'> {
  // Double-quoted PowerShell arguments (the shipped Windows app). Escape
  // expansion as well as quotes; a folder name is data, not shell syntax.
  const quote = (value: string) => `"${value.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"')}"`
  return {
    // --env is variadic: another option must separate it from the server name.
    claudeCommand: `claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio --scope user locust -- ${quote(node)} ${quote(bridge)} ${quote(connection)}`,
    codexConfig: `[mcp_servers.locust]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(bridge)}, ${JSON.stringify(connection)}]\nenv = { ELECTRON_RUN_AS_NODE = "1" }`
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > 256 * 1024) throw new Error('too large')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Authenticate HEADERS before attaching any body reader, including for bad JSON. */
export function mcpRequestHandler(token: () => string | undefined, call: (name: string, args: unknown) => Promise<McpToolResult>, body = readBody) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const expected = token()
    const auth = req.headers.authorization
    const supplied = typeof auth === 'string' && /^Bearer [0-9a-f]{64}$/.test(auth) ? auth.slice(7) : ''
    if (expected === undefined || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      res.writeHead(401, { connection: 'close' }).end()
      return
    }
    if (req.headers.origin !== undefined || req.method !== 'POST' || req.url !== '/tools/call') {
      res.writeHead(403, { connection: 'close' }).end()
      return
    }
    void (async () => {
      let input: unknown
      try { input = await body(req) } catch { res.writeHead(400).end(); return }
      // Revocation also applies to requests whose bodies were still arriving.
      if (token() !== expected) { res.writeHead(401).end(); return }
      if (typeof input !== 'object' || input === null || !('name' in input) || typeof input.name !== 'string') {
        res.writeHead(400).end(); return
      }
      const result = await call(input.name, 'arguments' in input ? input.arguments : {})
      if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    })().catch(() => { if (!res.destroyed) res.writeHead(500).end(JSON.stringify(mcpText('Locust could not complete that request. Nothing was retried.', true))) })
  }
}

const run = (file: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, shell: false, timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
})

/** mode 0600 is not an ACL on Windows. Remove inherited access before writing a token. */
export async function privateMcpFile(path: string): Promise<void> {
  if (process.platform !== 'win32') return
  const identity = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'])
  const sid = identity.match(/S-1-[0-9-]+/)?.[0]
  if (sid === undefined) throw new Error('Windows account could not be identified')
  await run('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:(F)`])
}

/** Separate from Claude's approvals: off means no socket, not an inert socket. */
export function createLocustMcpHost(options: {
  readonly directory: string
  readonly node: string
  readonly bridge: string
  readonly call: (name: string, args: unknown) => Promise<McpToolResult>
  readonly protectFile?: (path: string) => Promise<void>
}) {
  const connection = join(options.directory, MCP_CONNECTION_FILE)
  const settings = join(options.directory, MCP_SETTINGS_FILE)
  const setup = mcpSetup(options.node, options.bridge, connection)
  let server: Server | undefined
  let token: string | undefined
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const state = (message?: string): LocustMcpState => ({ enabled: server !== undefined, ...(server === undefined ? {} : setup), ...(message === undefined ? {} : { message }) })
  const stop = async (): Promise<void> => {
    token = undefined
    const listener = server
    server = undefined
    if (listener !== undefined) {
      listener.closeAllConnections()
      await new Promise<void>(resolve => listener.close(() => resolve()))
    }
    await rm(connection, { force: true })
  }
  const start = async (): Promise<void> => {
    if (server !== undefined) return
    await mkdir(options.directory, { recursive: true })
    const listener = createServer(mcpRequestHandler(() => token, options.call))
    listener.requestTimeout = 30_000
    listener.headersTimeout = 10_000
    listener.keepAliveTimeout = 1_000
    try {
      await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
      server = listener
      const address = listener.address()
      if (typeof address !== 'object' || address === null) throw new Error('no port')
      const next = randomBytes(32).toString('hex')
      const temp = connection + '.tmp'
      await rm(temp, { force: true })
      await writeFile(temp, '', { mode: 0o600, flag: 'wx' })
      // No bearer bytes are written until the account-only ACL is in place.
      await (options.protectFile ?? privateMcpFile)(temp)
      await writeFile(temp, JSON.stringify({ url: `http://127.0.0.1:${String(address.port)}/tools/call`, token: next }), { mode: 0o600 })
      await rename(temp, connection)
      token = next
    } catch {
      await stop()
      await rm(connection + '.tmp', { force: true })
      throw new Error('The local server could not be enabled. It is still off; no conversation was started.')
    }
  }
  const serial = (work: () => Promise<LocustMcpState>): Promise<LocustMcpState> => {
    const task = queue.then(work)
    queue = task.catch(() => undefined)
    return task
  }
  return {
    settings: async (): Promise<LocustMcpState> => { await queue; return state() },
    load: () => serial(async () => {
      if (disposed || server !== undefined) return state()
      await rm(connection, { force: true }) // a crashed process's token is never reused
      try { if (JSON.parse(await readFile(settings, 'utf8')).enabled === true) await start() } catch { /* Missing, unreadable or failed setup stays off. */ }
      return state()
    }),
    setEnabled: (enabled: unknown) => serial(async () => {
      if (disposed || typeof enabled !== 'boolean') return state('That server setting was not changed.')
      try {
        if (enabled) await start(); else await stop()
        await mkdir(options.directory, { recursive: true })
        await writeFile(settings + '.tmp', JSON.stringify({ enabled }), 'utf8')
        await rename(settings + '.tmp', settings)
        return state()
      } catch {
        await stop()
        return state('The local server setting could not be saved. The server is off; no conversation was started.')
      }
    }),
    dispose: async (): Promise<void> => { disposed = true; await queue; await stop() }
  }
}
