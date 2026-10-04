import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'

/**
 * What a person has already set up inside the coding-agent CLIs themselves.
 *
 * Locust does not create these and cannot run them. They are the agents,
 * commands and automations someone configured in Claude Code, Codex or Cursor
 * directly, and until now the app was silent about all of it -- so a person
 * with three Codex agents and three Claude commands opened Locust's
 * Automations screen and read "Nothing saved yet".
 *
 * Colin, 2026-09-07: "It would just be nice for them to be able to see the
 * routines/automations they've setup on their models." That is the whole
 * brief: LIST them, the way the thread lists tool calls. Authoring stays
 * where it already works, in the CLI.
 *
 * Nothing here executes anything, and only the front matter is read -- never
 * the instruction body, which is the person's own prose and none of the
 * app's business.
 */
export interface RuntimeArtifact {
  /** Which CLI it belongs to. */
  readonly runtime: string
  readonly kind: 'agent' | 'command' | 'automation'
  readonly name: string
  readonly description?: string
  /** Where it lives, so the app can say where to go and edit it. */
  readonly path: string
}

/** How many of each kind to read, so a large folder cannot stall a screen. */
const MAX_PER_LOCATION = 40
/** Front matter is short; a file bigger than this is read only at its head. */
const HEAD_BYTES = 4096

interface Location {
  readonly runtime: string
  readonly kind: RuntimeArtifact['kind']
  /** Relative to the person's home directory. */
  readonly dir: readonly string[]
  readonly extensions: readonly string[]
}

/**
 * Where each CLI keeps them, measured on a real machine 2026-09-07.
 *
 * Deliberately a fixed list rather than a search: these are the paths the
 * tools document for themselves, and hunting the home directory for anything
 * that looks like an agent would read files nobody asked us to read.
 */
export const ARTIFACT_LOCATIONS: readonly Location[] = [
  { runtime: 'claude', kind: 'agent', dir: ['.claude', 'agents'], extensions: ['.md'] },
  { runtime: 'claude', kind: 'command', dir: ['.claude', 'commands'], extensions: ['.md'] },
  { runtime: 'codex', kind: 'agent', dir: ['.codex', 'agents'], extensions: ['.toml'] },
  { runtime: 'codex', kind: 'automation', dir: ['.codex', 'automations'], extensions: ['.toml', '.md', '.json'] },
  { runtime: 'cursor', kind: 'agent', dir: ['.cursor', 'agents'], extensions: ['.md', '.json', '.toml'] }
]

const unquote = (value: string): string => {
  const trimmed = value.trim().replace(/,$/, '').trim()
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed)
  return (quoted?.[2] ?? trimmed).trim()
}

/**
 * The name and one-line description, from the front matter each format uses.
 *
 * Claude writes YAML between `---` fences; Codex writes TOML key/value at the
 * top of the file. Both state `name` and `description`, and a file that
 * states neither is still worth listing under its own filename -- it exists,
 * and saying so is the point.
 */
export function parseArtifact(
  fileName: string,
  contents: string
): { readonly name: string; readonly description?: string } {
  const fallback = basename(fileName, extname(fileName))
  const head = contents.slice(0, HEAD_BYTES)
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)
  const body = yaml?.[1] ?? head
  const field = (key: string): string | undefined => {
    // YAML `key: value` and TOML `key = value`, one line, first wins.
    const found = new RegExp(`^${key}\\s*[:=]\\s*(.+)$`, 'im').exec(body)
    const value = found?.[1] === undefined ? '' : unquote(found[1])
    return value.length === 0 ? undefined : value
  }
  const name = field('name') ?? fallback
  const description = field('description')
  return description === undefined ? { name } : { name, description }
}

/**
 * Read one location. A directory that is not there is not an error: it means
 * this person has not set any up, which is the ordinary case.
 */
async function readLocation(home: string, location: Location): Promise<readonly RuntimeArtifact[]> {
  const dir = join(home, ...location.dir)
  let names: readonly string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const wanted = names
    .filter((name) => location.extensions.includes(extname(name).toLowerCase()))
    .sort()
    .slice(0, MAX_PER_LOCATION)
  const found: RuntimeArtifact[] = []
  for (const name of wanted) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      const contents = await readFile(path, 'utf8')
      const parsed = parseArtifact(name, contents)
      found.push({
        runtime: location.runtime,
        kind: location.kind,
        name: parsed.name,
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        path
      })
    } catch {
      // Unreadable is the same as absent for a list: say nothing about it
      // rather than reporting a file the person cannot see either.
      continue
    }
  }
  return found
}

/**
 * Everything the installed runtimes have, for the runtimes given.
 *
 * `installed` gates it so the screen never lists agents for a CLI that is not
 * on this machine -- a leftover `.claude/agents` from an uninstall would
 * otherwise read as a working teammate's routine.
 */
export async function readRuntimeArtifacts(options: {
  readonly installed: readonly string[]
  readonly home?: string
}): Promise<readonly RuntimeArtifact[]> {
  const home = options.home ?? homedir()
  const wanted = ARTIFACT_LOCATIONS.filter((location) => options.installed.includes(location.runtime))
  const found = await Promise.all(wanted.map((location) => readLocation(home, location)))
  return found.flat()
}
