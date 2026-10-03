import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AcpCapabilities } from '@teammate/runtime-adapters'
import type { LocalRuntimeId, PublicAgentCapabilities } from '../shared/ipc.js'

/**
 * WHAT EACH ACP AGENT LAST SAID IT CAN DO (W12, 0.566).
 *
 * An Agent Client Protocol agent answers `initialize` with its capabilities
 * (acp-run.ts `acpCapabilitiesOf`); this keeps the last answer per runtime, in
 * memory and in `acp-capabilities.json` beside the other profile files, so
 * Settings > AI agents can say it in words after a relaunch. Shown only:
 * nothing here changes what Locust offers an agent (no files, no terminal).
 * A lost write costs one sentence until the next run, so nothing here fails
 * loudly, and the file is untrusted on read like every other.
 */
const FILE_NAME = 'acp-capabilities.json'
const SCHEMA_VERSION = 1 as const
const KEYS = ['continuesSessions', 'images', 'audio', 'embeddedContext', 'mcpOverHttp', 'mcpOverSse'] as const

export interface AcpCapabilitiesStore {
  load(): Promise<void>
  record(runtime: LocalRuntimeId, capabilities: AcpCapabilities): void
  get(runtime: LocalRuntimeId): PublicAgentCapabilities | undefined
  /** For the tests: the write in progress, settled. */
  settled(): Promise<void>
}

function parsed(text: string): Map<string, PublicAgentCapabilities> {
  const out = new Map<string, PublicAgentCapabilities>()
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return out
  }
  if (typeof value !== 'object' || value === null) return out
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION || typeof record.runtimes !== 'object' || record.runtimes === null) return out
  for (const [runtime, raw] of Object.entries(record.runtimes as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.toldAt !== 'string' || Number.isNaN(Date.parse(entry.toldAt))) continue
    if (!KEYS.every((key) => typeof entry[key] === 'boolean')) continue
    out.set(runtime, {
      continuesSessions: entry.continuesSessions as boolean,
      images: entry.images as boolean,
      audio: entry.audio as boolean,
      embeddedContext: entry.embeddedContext as boolean,
      mcpOverHttp: entry.mcpOverHttp as boolean,
      mcpOverSse: entry.mcpOverSse as boolean,
      toldAt: entry.toldAt
    })
  }
  return out
}

export function createAcpCapabilitiesStore(options: { readonly rootDirectory: string; readonly now?: () => Date }): AcpCapabilitiesStore {
  const path = join(options.rootDirectory, FILE_NAME)
  const now = options.now ?? (() => new Date())
  let known = new Map<string, PublicAgentCapabilities>()
  let writing: Promise<void> = Promise.resolve()

  const persist = (): void => {
    const body = JSON.stringify({ schemaVersion: SCHEMA_VERSION, runtimes: Object.fromEntries(known) }, null, 2)
    writing = writing
      .then(async () => {
        const temp = `${path}.${String(process.pid)}.tmp`
        await writeFile(temp, body, 'utf8')
        await rename(temp, path)
      })
      .catch(() => undefined)
  }

  return {
    async load() {
      known = parsed(await readFile(path, 'utf8').catch(() => ''))
    },
    record(runtime, capabilities) {
      const next: PublicAgentCapabilities = {
        continuesSessions: capabilities.continuesSessions,
        images: capabilities.images,
        audio: capabilities.audio,
        embeddedContext: capabilities.embeddedContext,
        mcpOverHttp: capabilities.mcpOverHttp,
        mcpOverSse: capabilities.mcpOverSse,
        toldAt: now().toISOString()
      }
      known.set(runtime, next)
      persist()
    },
    get(runtime) {
      return known.get(runtime)
    },
    settled() {
      return writing
    }
  }
}
