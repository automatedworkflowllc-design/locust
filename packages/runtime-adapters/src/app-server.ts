/**
 * A JSON-RPC client for `codex app-server`.
 *
 * This is a second transport beside `exec`, not a replacement. app-server is
 * marked experimental by Codex, and it is the only surface that carries an
 * approval channel -- so the product needs it, and also must not fall over if
 * the protocol shifts underneath it.
 *
 * Everything crossing this boundary is treated as untrusted and bounded: line
 * length, buffered bytes, in-flight requests, and how long a request may wait.
 * A provider that floods, stalls, or answers something never asked must degrade
 * to a reported failure rather than to unbounded memory or a hung mission.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export interface AppServerTransport {
  /** Write one framed line. Framing is newline-delimited JSON. */
  send(line: string): void
  close(): void
}

export interface AppServerNotification {
  readonly method: string
  readonly params: JsonValue | undefined
}

/** A request the SERVER makes of us -- the approval channel. */
export interface AppServerRequest {
  readonly id: JsonValue
  readonly method: string
  readonly params: JsonValue | undefined
}

export interface AppServerClientOptions {
  readonly transport: AppServerTransport
  /** Called for every server notification, in arrival order. */
  readonly onNotification: (notification: AppServerNotification) => void
  /**
   * Called when the server asks US something. The returned value is sent back
   * as the result. Throwing answers with an error rather than stranding the
   * server, because an unanswered approval request stalls the run forever.
   */
  readonly onRequest: (request: AppServerRequest) => Promise<JsonValue>
  /** Reported when the client gives up on a line or a request. */
  readonly onDiagnostic?: (diagnostic: AppServerDiagnostic) => void
  readonly maxLineBytes?: number
  readonly maxBufferedBytes?: number
  readonly maxPendingRequests?: number
  readonly requestTimeoutMs?: number
}

export interface AppServerDiagnostic {
  readonly code:
    | 'line-too-long'
    | 'buffer-overflow'
    | 'unparsable-line'
    | 'unknown-response'
    | 'request-timeout'
    | 'request-handler-failed'
    | 'too-many-pending'
  readonly message: string
}

export interface AppServerClient {
  /** Feed raw transport output. Any chunking is fine; framing is handled here. */
  accept(chunk: string): void
  request(method: string, params?: JsonValue): Promise<JsonValue>
  notify(method: string, params?: JsonValue): void
  /** Fail every in-flight request and stop accepting more. */
  dispose(reason: string): void
  readonly pendingCount: number
}

const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_PENDING = 256
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createAppServerClient(options: AppServerClientOptions): AppServerClient {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
  const maxPending = options.maxPendingRequests ?? DEFAULT_MAX_PENDING
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const diagnostic = options.onDiagnostic ?? ((): void => undefined)

  interface Pending {
    readonly resolve: (value: JsonValue) => void
    readonly reject: (error: Error) => void
    readonly timer: ReturnType<typeof setTimeout>
  }

  const pending = new Map<number, Pending>()
  let nextId = 0
  let buffer = ''
  let disposed = false

  const settle = (id: number, apply: (entry: Pending) => void): void => {
    const entry = pending.get(id)
    if (entry === undefined) return
    pending.delete(id)
    clearTimeout(entry.timer)
    apply(entry)
  }

  const handleMessage = (message: Record<string, unknown>): void => {
    const hasId = message.id !== undefined && message.id !== null
    const method = typeof message.method === 'string' ? message.method : undefined

    // A response: an id and no method.
    if (hasId && method === undefined) {
      const id = typeof message.id === 'number' ? message.id : Number(message.id)
      if (!Number.isFinite(id) || !pending.has(id)) {
        // A response to something we never asked. Reporting it is the point:
        // silently dropping would hide a desynchronized stream.
        diagnostic({ code: 'unknown-response', message: 'A response arrived for an unknown request.' })
        return
      }
      if (message.error !== undefined) {
        const text = isObject(message.error) && typeof message.error.message === 'string'
          ? message.error.message
          : 'The app server reported an error.'
        settle(id, (entry) => entry.reject(new Error(text)))
        return
      }
      settle(id, (entry) => entry.resolve((message.result ?? null) as JsonValue))
      return
    }

    if (method === undefined) {
      diagnostic({ code: 'unparsable-line', message: 'A message had neither a method nor a known id.' })
      return
    }

    // A server -> client request: id AND method.
    if (hasId) {
      const request: AppServerRequest = {
        id: message.id as JsonValue,
        method,
        params: (message.params ?? undefined) as JsonValue | undefined
      }
      void options
        .onRequest(request)
        .then((result) => {
          if (disposed) return
          options.transport.send(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
        })
        .catch((error: unknown) => {
          // Always answer. An unanswered approval request stalls the run
          // forever, which is a worse failure than a refused one.
          diagnostic({
            code: 'request-handler-failed',
            message: `Answering ${method} failed: ${error instanceof Error ? error.message : 'unknown'}`
          })
          if (disposed) return
          // A handler may name its JSON-RPC error -- "Method not found" for a
          // method the client never offered (ACP, 0.377). Anything else is the
          // generic failure it always was.
          const code = error instanceof Error && Number.isInteger((error as Error & { code?: unknown }).code)
            ? (error as Error & { code: number }).code
            : -32_000
          options.transport.send(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code, message: code === -32_000 ? 'The client could not answer this request.' : (error as Error).message }
            })}\n`
          )
        })
      return
    }

    options.onNotification({
      method,
      params: (message.params ?? undefined) as JsonValue | undefined
    })
  }

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    if (Buffer.byteLength(trimmed, 'utf8') > maxLineBytes) {
      diagnostic({ code: 'line-too-long', message: 'A message exceeded the line size limit and was dropped.' })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      diagnostic({ code: 'unparsable-line', message: 'A message could not be parsed as JSON.' })
      return
    }
    if (!isObject(parsed)) {
      diagnostic({ code: 'unparsable-line', message: 'A message was not a JSON object.' })
      return
    }
    handleMessage(parsed)
  }

  return {
    get pendingCount() {
      return pending.size
    },

    accept(chunk: string): void {
      if (disposed) return
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > maxBufferedBytes) {
        // A stream with no newline in sight is either broken or hostile.
        // Dropping what is buffered keeps memory bounded; the next newline
        // resynchronizes the stream.
        buffer = ''
        diagnostic({ code: 'buffer-overflow', message: 'Buffered output exceeded its limit and was dropped.' })
        return
      }
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        handleLine(line)
        index = buffer.indexOf('\n')
      }
    },

    request(method: string, params?: JsonValue): Promise<JsonValue> {
      if (disposed) return Promise.reject(new Error('The app server client is closed.'))
      if (pending.size >= maxPending) {
        diagnostic({ code: 'too-many-pending', message: 'Too many app server requests are in flight.' })
        return Promise.reject(new Error('Too many app server requests are in flight.'))
      }
      const id = ++nextId
      return new Promise<JsonValue>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id, (entry) => entry.reject(new Error(`The app server did not answer ${method} in time.`)))
          diagnostic({ code: 'request-timeout', message: `${method} timed out.` })
        }, requestTimeoutMs)
        // Node keeps the process alive for pending timers; a client waiting on
        // a slow provider should not be what stops the app from exiting.
        if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
        pending.set(id, { resolve, reject, timer })
        options.transport.send(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`)
      })
    },

    notify(method: string, params?: JsonValue): void {
      if (disposed) return
      options.transport.send(`${JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} })}\n`)
    },

    dispose(reason: string): void {
      if (disposed) return
      disposed = true
      buffer = ''
      for (const id of [...pending.keys()]) {
        settle(id, (entry) => entry.reject(new Error(reason)))
      }
      options.transport.close()
    }
  }
}
