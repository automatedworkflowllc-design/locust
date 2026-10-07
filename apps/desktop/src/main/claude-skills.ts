import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * SKILLS FOR A CLAUDE CODE TEAMMATE (0.679).
 *
 * Claude Code runs a skill through its `Skill` tool, and finds skills in the
 * folder's `.claude/skills` and the person's `~/.claude/skills`. Every Locust
 * run outside Auto is started with `--restricted`, and MEASURED 2026-10-04 on
 * 2.1.289 (FINDING-claude-skills-under-restricted.md, eight Haiku runs): that
 * flag drops both of those folders, and `--setting-sources project` and
 * `--add-dir` do not bring them back. What does is `--plugin-dir`: the same
 * SKILL.md inside `<plugin>/skills/<name>/`, beside a
 * `.claude-plugin/plugin.json`, loaded under `--restricted`, was called, and
 * was followed. Its name gains the plugin's: `project:review`.
 *
 * So before a Claude run outside Auto, this builds those plugins from the
 * skill folders, in a folder of the run's own:
 *
 *   - `project`, from `<folder>/.claude/skills` -- always. A project's skills
 *     are part of the project, the way its CLAUDE.md is.
 *   - `personal`, from `~/.claude/skills` -- only when the person has said so
 *     in Settings (`claudeOwnSkills`). Their own skills are theirs, written
 *     for their own sessions; a teammate gets them when asked, not by default.
 *
 * COPIED, never linked. A junction would always be current, but the run's
 * folder is removed when the run ends, and a removal that followed a link
 * would delete the person's own skills. A copy can only ever delete itself.
 * Only folders holding a SKILL.md are copied, within a size bound, so a stray
 * build folder beside the skills is never carried along.
 *
 * Auto needs none of this: it runs without `--restricted`, as the person, and
 * Claude Code finds both folders itself.
 */

/** Claude Code's own rule for a plugin's skill: `skills/<name>/SKILL.md`. */
const SKILL_FILE = 'SKILL.md'
/** One skill folder larger than this is left out: a skill is instructions, not a payload. */
const MOST_BYTES_A_SKILL = 5 * 1024 * 1024
/** And all of them together, per plugin. */
const MOST_BYTES_ALL = 40 * 1024 * 1024
const MOST_SKILLS = 200

export type SkillPluginName = 'project' | 'personal'

export interface SkillPlugin {
  readonly name: SkillPluginName
  /** The folder to name with `--plugin-dir`. */
  readonly dir: string
  /** The skills it carries, by the name a run calls them: `project:review`. */
  readonly skills: readonly string[]
}

export interface PreparedSkills {
  readonly plugins: readonly SkillPlugin[]
  /** Removes the run's copies. Safe to call twice. */
  readonly dispose: () => Promise<void>
}

/** The size of a folder, giving up past `limit`. Links are not followed and count as nothing. */
async function sizeWithin(path: string, limit: number): Promise<number | undefined> {
  let total = 0
  const pending = [path]
  while (pending.length > 0) {
    const at = pending.pop() as string
    const entries = await readdir(at, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(at, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) total += (await stat(full)).size
      if (total > limit) return undefined
    }
  }
  return total
}

/** The skill folders under `root`: each a real folder (not a link) with a SKILL.md, within the bounds. */
export async function skillFoldersIn(root: string): Promise<readonly string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  let total = 0
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (found.length >= MOST_SKILLS) break
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    // A name Claude Code would take: the folder's name is the skill's.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.name)) continue
    const folder = join(root, entry.name)
    try {
      const file = await lstat(join(folder, SKILL_FILE))
      if (!file.isFile()) continue
      const size = await sizeWithin(folder, MOST_BYTES_A_SKILL)
      if (size === undefined || total + size > MOST_BYTES_ALL) continue
      total += size
      found.push(entry.name)
    } catch {
      continue
    }
  }
  return found
}

async function buildPlugin(base: string, name: SkillPluginName, from: string): Promise<SkillPlugin | undefined> {
  const names = await skillFoldersIn(from)
  if (names.length === 0) return undefined
  const dir = join(base, name)
  await mkdir(join(dir, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(dir, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name, description: name === 'project' ? "This folder's own skills" : 'Your own Claude Code skills', version: '1.0.0' })}\n`
  )
  const copied: string[] = []
  for (const skill of names) {
    try {
      // A link inside a skill is left out, not copied: the copy holds only
      // real files, so removing it can never reach past it.
      await cp(join(from, skill), join(dir, 'skills', skill), {
        recursive: true,
        filter: async (source) => !(await lstat(source)).isSymbolicLink()
      })
      copied.push(`${name}:${skill}`)
    } catch {
      // A skill that cannot be read is left out; the rest still load.
    }
  }
  return copied.length === 0 ? undefined : { name, dir, skills: copied }
}

/**
 * The plugins one Claude run outside Auto should be started with, built under
 * `scratchRoot` in a folder of its own and removed by `dispose`.
 */
export async function prepareClaudeSkills(options: {
  readonly scratchRoot: string
  readonly workspacePath: string
  readonly ownSkills: boolean
  readonly homeDirectory?: string
}): Promise<PreparedSkills> {
  const base = join(options.scratchRoot, randomUUID())
  const dispose = async (): Promise<void> => {
    await rm(base, { recursive: true, force: true }).catch(() => undefined)
  }
  try {
    const plugins: SkillPlugin[] = []
    const project = await buildPlugin(base, 'project', join(options.workspacePath, '.claude', 'skills'))
    if (project !== undefined) plugins.push(project)
    if (options.ownSkills) {
      const personal = await buildPlugin(base, 'personal', join(options.homeDirectory ?? homedir(), '.claude', 'skills'))
      if (personal !== undefined) plugins.push(personal)
    }
    if (plugins.length === 0) await dispose()
    return { plugins, dispose }
  } catch {
    await dispose()
    return { plugins: [], dispose }
  }
}

/** Copies a crash left behind: every run folder under the scratch root, at launch, before any run. */
export async function clearClaudeSkillCopies(scratchRoot: string): Promise<void> {
  await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined)
}
