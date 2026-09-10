import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MissionApprovalAnswer, MissionApprovalRequest } from '../shared/ipc.js'

/**
 * Locust as Claude Code's permission host.
 *
 * Claude Code asks before using a connector tool, and a printed run has
 * nowhere to put that question -- so every call was refused, and 0.61.0
 * papered over it with a blanket allow rule per server. That works and it
 * is what Colin asked for, but it is not how any other client behaves:
 * everywhere else the model asks, the person answers, and "always" is
 * remembered.
 *
 * `--permission-prompt-tool` is the way to give a printed run somewhere to
 * ask. MEASURED 2026-09-10 with a throwaway server: the CLI calls the named
 * MCP tool with `{tool_name, input, tool_use_id}` and waits;
 * `{"behavior":"allow"}` lets the call through, `{"behavior":"deny",
 * "message"}` reaches the model verbatim. It works in `--print` under
 * `--restricted` in the strictest permission mode. It is connectors only --
 * Bash and Edit are granted by `--tools` and never route through it.
 *
 * The shape: a tiny stdio MCP server ships beside the app
 * (resources/locust-permission-bridge.mjs). Each run gets an `mcp.json`
 * naming it, with a loopback URL and a token minted for that run in its
 * environment. The bridge forwards each question here over HTTP; this file
 * turns it into the approval card the app already has, waits for the
 * person, and answers. A token that is not one this process minted is
 * refused before anything else in the request is read.
 */

export const PERMISSION_TOOL_NAME = 'mcp__locust__approve'

export interface PermissionHost {
  /** Bring the listener up. Idempotent. */
  start(): Promise<void>
  /** The port the listener took. 0 until started. */
  readonly port: number
  /**
   * Prepare one run: mint its token, write its mcp.json, remember it. The
   * config path goes on the command line; nothing else leaves this process.
   */
  register(run: { readonly runId: string; readonly missionId: string; readonly cwd: string | null }): Promise<{
    readonly configPath: string
    readonly toolName: string
  }>
  /** A person's answer to a card. False when the id names nothing pending. */
  decide(answer: MissionApprovalAnswer): boolean
  /** The run is over: refuse anything still waiting, forget its token, remove its config. */
  release(runId: string): Promise<void>
  dispose(): Promise<void>
}

export type BridgeAnswer = { readonly behavior: 'allow'; readonly updatedInput: unknown } | { readonly behavior: 'deny'; readonly message: string }

interface Registered {
  readonly runId: string
  readonly missionId: string
  readonly cwd: string | null
  readonly configDir: string
  /** Servers the person said "always" to, by tool prefix, for this run. */
  readonly always: Set<string>
}

interface Pending {
  readonly runId: string
  readonly missionId: string
  /** The server prefix of the tool that asked, so "always" knows what to remember. */
  readonly prefix: string
  readonly input: unknown
  readonly resolve: (answer: BridgeAnswer) => void
}

/** `mcp__claude_ai_Robinhood__get_accounts` -> `mcp__claude_ai_Robinhood__` */
export function serverPrefixOf(toolName: string): string {
  const match = /^(mcp__[A-Za-z0-9_]+?__)/.exec(toolName)
  return match?.[1] ?? toolName
}

/** The sentence on the card, from the tool name the way the activity rows say it. */
export function connectorSummary(toolName: string): string {
  const match = /^mcp__([A-Za-z0-9_]+?)__(.+)$/.exec(toolName)
  if (match === null) return `Use ${toolName}`
  const server = match[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ')
  return `Use ${match[2]!} on ${server}`
}

/**
 * The mcp.json one run is launched with.
 *
 * Exported so the shape is testable without a listener: the CLI reads this
 * file, and a field misnamed here is a bridge that never starts and a run
 * whose every connector call is silently refused.
 */
export function bridgeConfig(options: {
  readonly bridgePath: string
  readonly url: string
  readonly token: string
  readonly node: string
}): string {
  return JSON.stringify(
    {
      mcpServers: {
        locust: {
          command: options.node,
          args: [options.bridgePath],
          // `ELECTRON_RUN_AS_NODE` makes Electron's own binary behave as plain
          // node, so the bridge runs on a runtime that is GUARANTEED to be on
          // this machine -- Claude Code no longer needs node on PATH and this
          // must not depend on it either.
          env: { ELECTRON_RUN_AS_NODE: '1', LOCUST_PERMISSION_URL: options.url, LOCUST_PERMISSION_TOKEN: options.token }
        }
      }
    },
    null,
    2
  )
}

const deny = (message: string): BridgeAnswer => ({ behavior: 'deny', message })

export function createPermissionHost(options: {
  /** Absolute path of the bridge script the CLI will spawn. */
  readonly bridgePath: string
  /** The node the bridge runs on. Electron's own binary can stand in when `ELECTRON_RUN_AS_NODE` is set for it. */
  readonly node: string
  /** Raise a card. The host answers when `decide` is called with its id. */
  readonly emitApproval: (request: MissionApprovalRequest) => void
  readonly createId?: () => string
  readonly now?: () => Date
  /** A fixed port for tests; 0 lets the OS choose. */
  readonly port?: number
}): PermissionHost {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const tokens = new Map<string, Registered>()
  const byRun = new Map<string, string>()
  const pending = new Map<string, Pending>()
  let server: Server | undefined
  let port = 0

  const answerRequest = async (body: unknown): Promise<BridgeAnswer> => {
    const asked = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    // The token FIRST. Anything on this machine can reach a loopback port;
    // only a process handed a token by this one is a run of ours.
    const registered = typeof asked.token === 'string' ? tokens.get(asked.token) : undefined
    if (registered === undefined) return deny('this request did not come from a Locust run.')
    const toolName = typeof asked.toolName === 'string' && asked.toolName.length > 0 ? asked.toolName : 'a tool'
    const prefix = serverPrefixOf(toolName)
    const input = asked.input ?? {}
    if (registered.always.has(prefix)) return { behavior: 'allow', updatedInput: input }
    const approvalId = createId()
    const decided = new Promise<BridgeAnswer>((resolve) => {
      pending.set(approvalId, { runId: registered.runId, missionId: registered.missionId, prefix, input, resolve })
    })
    options.emitApproval({
      approvalId,
      runId: registered.runId,
      missionId: registered.missionId,
      kind: 'connector',
      runtime: 'claude',
      summary: connectorSummary(toolName),
      // The input the connector would be called with, bounded. It is the
      // one thing a person can judge a connector call by.
      detail: JSON.stringify(input).slice(0, 600),
      cwd: registered.cwd,
      requestedAt: now().toISOString()
    })
    return decided
  }

  const host: PermissionHost = {
    get port() {
      return port
    },

    async start() {
      if (server !== undefined) return
      const listener = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/approve') {
          res.writeHead(404).end()
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          // A permission question is a tool name and an input. Anything
          // larger than this is not one.
          if (size <= 256 * 1024) chunks.push(chunk)
        })
        req.on('end', () => {
          let body: unknown
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            body = {}
          }
          void answerRequest(body).then((answer) => {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer))
          })
        })
      })
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject)
        // Loopback only. Never 0.0.0.0: this is a door into approving things.
        listener.listen(options.port ?? 0, '127.0.0.1', () => resolve())
      })
      const address = listener.address()
      port = typeof address === 'object' && address !== null ? address.port : 0
      server = listener
    },

    async register(run) {
      if (server === undefined) await host.start()
      const token = createId()
      const configDir = await mkdtemp(join(tmpdir(), 'locust-permission-'))
      const configPath = join(configDir, 'mcp.json')
      await writeFile(
        configPath,
        bridgeConfig({
          bridgePath: options.bridgePath,
          url: `http://127.0.0.1:${String(port)}/approve`,
          token,
          node: options.node
        }),
        'utf8'
      )
      tokens.set(token, { runId: run.runId, missionId: run.missionId, cwd: run.cwd, configDir, always: new Set() })
      byRun.set(run.runId, token)
      return { configPath, toolName: PERMISSION_TOOL_NAME }
    },

    decide(answer) {
      const waiting = pending.get(answer.approvalId)
      if (waiting === undefined) return false
      pending.delete(answer.approvalId)
      if (!('decision' in answer)) {
        // A question's answer reaching a permission: refused, and said.
        waiting.resolve(deny('Locust did not send that answer: it belongs to a question, and the runtime was waiting on a permission.'))
        return true
      }
      if (answer.decision === 'deny') {
        waiting.resolve(deny('Denied in Locust.'))
        return true
      }
      if (answer.decision === 'approve-always') {
        // Remembered for THIS run and this connector. The next call from the
        // same connector answers itself; a different connector still asks.
        const token = byRun.get(waiting.runId)
        const registered = token === undefined ? undefined : tokens.get(token)
        registered?.always.add(waiting.prefix)
      }
      waiting.resolve({ behavior: 'allow', updatedInput: waiting.input })
      return true
    },

    async release(runId) {
      const token = byRun.get(runId)
      byRun.delete(runId)
      for (const [id, waiting] of pending) {
        if (waiting.runId === runId) {
          pending.delete(id)
          waiting.resolve(deny('The run ended before anyone answered.'))
        }
      }
      if (token === undefined) return
      const registered = tokens.get(token)
      tokens.delete(token)
      if (registered !== undefined) await rm(registered.configDir, { recursive: true, force: true }).catch(() => undefined)
    },

    async dispose() {
      for (const runId of [...byRun.keys()]) await host.release(runId)
      const listener = server
      server = undefined
      if (listener !== undefined) await new Promise<void>((resolve) => listener.close(() => resolve()))
    }
  }
  return host
}
