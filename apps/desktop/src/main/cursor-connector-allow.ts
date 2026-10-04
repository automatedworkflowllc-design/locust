import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Let a Cursor run outside Auto call the connectors the person configured.
 *
 * MEASURED 2026-09-15/16 in Colin's own ledger: 17, 5, 3 and 2 `user
 * rejected MCP` per run in Accept edits, 0 in Auto. `--approve-mcps` approves
 * the SERVER; each CALL still asks, and a print-mode run has nobody to answer,
 * so every call resolved to "no". The effective policy was not "safer", it
 * was "always no" -- for servers the person set up themselves and that
 * Cursor's own app uses freely.
 *
 * Making Accept edits pass `--force` would be wrong: that is Auto for shell
 * commands under another name. Cursor's CLI reads permissions from
 * `<workspace>/.cursor/cli.json` -- `Mcp(<server>:<tool>)` patterns with `*`
 * wildcards, deny winning over allow (cursor.com/docs/cli/reference/
 * permissions) -- the same shape Colin's own `~/.cursor/cli-config.json`
 * already holds four Robinhood tools in. So at the start of a Cursor run
 * outside Auto, `Mcp(<server>:*)` for each configured server is merged into
 * that file's allow list. Nothing is removed, `deny` is never touched, and a
 * file that does not parse is left alone rather than written over.
 *
 * Colin, 2026-09-10: "just let them have access to the mcp tools if the
 * client has access to it." The mode governs this machine; a connector the
 * person set up in Cursor themselves is not this machine. Decided 2026-09-17
 * (`docs/HARNESS-COMMUNICATION-2026-09-17.md`).
 */

export const CURSOR_PROJECT_CONFIG = join('.cursor', 'cli.json')

export function cursorAllowRule(server: string): string {
  return `Mcp(${server}:*)`
}

export interface MergedCursorConfig {
  /** The file to write, or undefined when nothing needs writing. */
  readonly text: string | undefined
  readonly added: readonly string[]
}

/**
 * The file with the missing rules added, or `undefined` when the file cannot
 * be read as the config it is supposed to be. An absent file is an empty one.
 */
export function mergedCursorConfig(text: string | undefined, servers: readonly string[]): MergedCursorConfig | undefined {
  let value: unknown = {}
  if (text !== undefined && text.trim().length > 0) {
    try {
      value = JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const permissions = record.permissions
  if (permissions !== undefined && (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions))) return undefined
  const held = (permissions ?? {}) as Record<string, unknown>
  if (held.allow !== undefined && !Array.isArray(held.allow)) return undefined
  const allow = [...((held.allow ?? []) as unknown[])]
  const added: string[] = []
  for (const server of servers) {
    const rule = cursorAllowRule(server)
    if (!allow.includes(rule) && !allow.includes('Mcp(*:*)')) {
      allow.push(rule)
      added.push(rule)
    }
  }
  if (added.length === 0) return { text: undefined, added }
  const next = { ...record, permissions: { ...held, allow, ...(held.deny === undefined ? { deny: [] } : {}) } }
  return { text: `${JSON.stringify(next, null, 2)}\n`, added }
}

export interface AllowIo {
  readonly readFile: (path: string) => Promise<string>
  readonly writeFile: (path: string, text: string) => Promise<void>
  readonly mkdir: (path: string) => Promise<unknown>
}

const nodeIo: AllowIo = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true })
}

/**
 * Merge the rules into the workspace's Cursor config. Returns the rules that
 * were added this time; an empty list means they were already there, there
 * were no servers, or the file could not be read (never written over).
 */
export async function allowCursorConnectors(
  workspace: string,
  servers: readonly string[],
  io: AllowIo = nodeIo
): Promise<readonly string[]> {
  if (servers.length === 0) return []
  const path = join(workspace, CURSOR_PROJECT_CONFIG)
  let text: string | undefined
  try {
    text = await io.readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return []
  }
  const merged = mergedCursorConfig(text, servers)
  if (merged === undefined || merged.text === undefined) return []
  await io.mkdir(dirname(path))
  await io.writeFile(path, merged.text)
  return merged.added
}
