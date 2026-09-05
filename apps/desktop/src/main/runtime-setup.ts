import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { PublicRuntimeSetup } from '../shared/ipc.js'

/**
 * What each runtime has configured for itself: MCP servers and hooks, read
 * from the runtime's own files and shown, never changed.
 *
 * Colin, 2026-09-05, on hooks: "make sure the user actually knows what's
 * going on". A hook fires shell commands at points in a run; an MCP server
 * gives the runtime tools. Both are the runtime's own configuration, which
 * is why Locust adds none of its own (a Locust-level hook would fire beside
 * the runtime's, and a second MCP config would be one nothing reads). What
 * Locust owes is to SAY what is there, so a formatter that runs mid-mission
 * or a tool a teammate reaches for is not a surprise.
 *
 * Files are read with a byte bound and parsed leniently: a file that cannot
 * be read is named as unreadable, never guessed at. Only names are kept --
 * a server's command line and a hook's script can hold secrets, and the
 * screen needs neither.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_NAMES = 40

export interface RuntimeSetupOptions {
  readonly workspacePath: string | undefined
  readonly homeDirectory?: string
  /** Test seam. */
  readonly read?: (path: string) => Promise<string>
}

interface Found {
  readonly mcpServers: string[]
  readonly hooks: string[]
  readonly sources: string[]
  readonly unreadable: string[]
}

const fresh = (): Found => ({ mcpServers: [], hooks: [], sources: [], unreadable: [] })

function addNames(into: string[], names: readonly string[]): void {
  for (const name of names) {
    if (typeof name !== 'string' || name.trim().length === 0) continue
    if (into.includes(name)) continue
    if (into.length >= MAX_NAMES) return
    into.push(name.slice(0, 80))
  }
}

async function readJson(path: string, options: RuntimeSetupOptions, found: Found): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await (options.read ?? ((p: string) => readFile(p, 'utf8')))(path)
  } catch (error) {
    // Absent is the common case and not a finding; anything else is.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') found.unreadable.push(path)
    return undefined
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    found.unreadable.push(path)
    return undefined
  }
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null) {
      found.unreadable.push(path)
      return undefined
    }
    found.sources.push(path)
    return value as Record<string, unknown>
  } catch {
    found.unreadable.push(path)
    return undefined
  }
}

async function readText(path: string, options: RuntimeSetupOptions, found: Found): Promise<string | undefined> {
  try {
    const text = await (options.read ?? ((p: string) => readFile(p, 'utf8')))(path)
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
      found.unreadable.push(path)
      return undefined
    }
    found.sources.push(path)
    return text
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') found.unreadable.push(path)
    return undefined
  }
}

const keysOf = (value: unknown): string[] => (typeof value === 'object' && value !== null ? Object.keys(value as object) : [])

/** Hook events with how many entries each: "Stop (1)". */
function hookLabels(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value as Record<string, unknown>).map(([event, entries]) => {
    const count = Array.isArray(entries) ? entries.length : typeof entries === 'object' && entries !== null ? Object.keys(entries).length : 1
    return `${event} (${String(count)})`
  })
}

/** The keys of Claude Code's per-project record, for either slash style the file uses. */
function claudeProjectRecord(projects: unknown, workspacePath: string): Record<string, unknown> | undefined {
  if (typeof projects !== 'object' || projects === null) return undefined
  const wanted = new Set([workspacePath, workspacePath.replace(/\\/g, '/'), workspacePath.replace(/\//g, '\\')].map((p) => p.toLowerCase()))
  for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
    if (wanted.has(key.toLowerCase()) && typeof value === 'object' && value !== null) return value as Record<string, unknown>
  }
  return undefined
}

async function claude(options: RuntimeSetupOptions, home: string, ws: string | undefined): Promise<Found> {
  const found = fresh()
  const user = await readJson(join(home, '.claude', 'settings.json'), options, found)
  addNames(found.hooks, hookLabels(user?.hooks))
  if (ws !== undefined) {
    for (const name of ['settings.json', 'settings.local.json']) {
      const project = await readJson(join(ws, '.claude', name), options, found)
      addNames(found.hooks, hookLabels(project?.hooks))
    }
  }
  const global = await readJson(join(home, '.claude.json'), options, found)
  addNames(found.mcpServers, keysOf(global?.mcpServers))
  if (ws !== undefined) {
    addNames(found.mcpServers, keysOf(claudeProjectRecord(global?.projects, ws)?.mcpServers))
    const projectMcp = await readJson(join(ws, '.mcp.json'), options, found)
    addNames(found.mcpServers, keysOf(projectMcp?.mcpServers))
  }
  return found
}

async function codex(options: RuntimeSetupOptions, home: string, ws: string | undefined): Promise<Found> {
  const found = fresh()
  for (const path of [join(home, '.codex', 'config.toml'), ...(ws === undefined ? [] : [join(ws, '.codex', 'config.toml')])]) {
    const text = await readText(path, options, found)
    if (text === undefined) continue
    // Table headers only: [mcp_servers.<name>] and nothing beneath them.
    addNames(found.mcpServers, [...text.matchAll(/^\s*\[mcp_servers\.([^\]\s.]+)\]/gm)].map((match) => match[1] ?? ''))
    if (/^\s*notify\s*=/m.test(text)) addNames(found.hooks, ['notify (1)'])
  }
  return found
}

async function cursor(options: RuntimeSetupOptions, home: string, ws: string | undefined): Promise<Found> {
  const found = fresh()
  for (const dir of [join(home, '.cursor'), ...(ws === undefined ? [] : [join(ws, '.cursor')])]) {
    const mcp = await readJson(join(dir, 'mcp.json'), options, found)
    addNames(found.mcpServers, keysOf(mcp?.mcpServers))
    const hooks = await readJson(join(dir, 'hooks.json'), options, found)
    addNames(found.hooks, hookLabels(hooks?.hooks))
  }
  return found
}

async function opencode(options: RuntimeSetupOptions, home: string, ws: string | undefined): Promise<Found> {
  const found = fresh()
  const paths = [join(home, '.config', 'opencode', 'opencode.json'), ...(ws === undefined ? [] : [join(ws, 'opencode.json'), join(ws, '.opencode', 'opencode.json')])]
  for (const path of paths) {
    const config = await readJson(path, options, found)
    addNames(found.mcpServers, keysOf(config?.mcp))
  }
  return found
}

async function copilot(options: RuntimeSetupOptions, home: string): Promise<Found> {
  const found = fresh()
  const config = await readJson(join(home, '.copilot', 'mcp-config.json'), options, found)
  addNames(found.mcpServers, keysOf(config?.mcpServers))
  return found
}

/** Every runtime's own MCP servers and hooks, by runtime id. */
export async function readRuntimeSetup(options: RuntimeSetupOptions): Promise<Readonly<Record<string, PublicRuntimeSetup>>> {
  const home = options.homeDirectory ?? homedir()
  const ws = options.workspacePath === undefined || options.workspacePath.length === 0 ? undefined : resolve(options.workspacePath)
  const entries: [string, Found][] = [
    ['claude', await claude(options, home, ws)],
    ['codex', await codex(options, home, ws)],
    ['cursor', await cursor(options, home, ws)],
    ['opencode', await opencode(options, home, ws)],
    ['copilot', await copilot(options, home)]
  ]
  return Object.fromEntries(
    entries.map(([id, found]) => [id, { mcpServers: found.mcpServers, hooks: found.hooks, sources: found.sources, unreadable: found.unreadable }])
  )
}
