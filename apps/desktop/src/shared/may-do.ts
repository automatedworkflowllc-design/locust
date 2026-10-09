import type { MissionRuntimeId, MissionSandbox } from '@teammate/runtime-adapters'

import type { MissionMode } from './ipc.js'
import { runtimeDisplayName } from './runtimes.js'

/**
 * WHAT A RUN MAY DO, runtime by runtime (0.359).
 *
 * The Activity panel said the same three rows for every runtime, and the
 * third was false for the one a new person meets first. A Research & money
 * teammate on OpenCode's free model searched the web twice, and the panel
 * listing those two searches said, under them, "deny: ... any network access
 * beyond the model's own" (the first-session drive, packaged 0.358). OpenCode
 * is given no rule about the web at all, so its own search and fetch tools
 * run. The sentence had been "any network the runtime does not make itself"
 * until 0.355 shortened it into something untrue.
 *
 * So every row here is a thing Locust hands THAT runtime in THAT mode, read
 * off the command it builds (packages/runtime-adapters/src/commands.ts), and
 * nothing else. What Locust does not set is not guessed at: the last line
 * says it is left to the runtime's own settings. The rows are checked
 * against the real command builders in what-it-may-do-is-what-it-was-given.
 */
export interface MayDoRow {
  readonly verdict: 'allow' | 'deny'
  /** It reaches past this folder: amber rather than green. */
  readonly wide?: true
  readonly text: string
}

export interface MayDo {
  readonly rows: readonly MayDoRow[]
  /** What decides everything the rows do not name. */
  readonly rest: string
}

const READ: MayDoRow = { verdict: 'allow', text: 'read the files in this folder' }
const NO_CHANGES: MayDoRow = { verdict: 'deny', text: 'changing any file' }
const CHANGES_HERE: MayDoRow = { verdict: 'allow', text: 'change files in this folder' }
const CHANGES_ANYWHERE: MayDoRow = { verdict: 'allow', wide: true, text: 'change files anywhere your account can reach, in this folder and outside it' }
const ANY_COMMAND: MayDoRow = { verdict: 'allow', wide: true, text: 'run any command your account can run, and reach any network' }
const NO_COMMANDS: MayDoRow = { verdict: 'deny', text: 'running commands' }
/** A command with nothing around it but the person's own account. */
const OPEN_COMMANDS: MayDoRow = { verdict: 'allow', wide: true, text: 'run commands, which can reach anything your account can' }
const THE_WEB: MayDoRow = { verdict: 'allow', wide: true, text: 'search the web and open web pages' }
const CLAUDE_SKILLS: MayDoRow = { verdict: 'allow', text: "use this folder's skills, yours when Settings lends them, and the ones you kept from GitHub, with only the tools listed here" }
const NOT_OUTSIDE: MayDoRow = { verdict: 'deny', text: 'opening files outside this folder, other than by running a command' }

/**
 * The rows for one run. `sandbox` is what the run was started with, read
 * from its start receipt -- never the mode the composer shows now -- and
 * `mode` says whether it was Approve-each, which shares Edit's sandbox and
 * stops before each act instead.
 */
export function whatItMayDo(runtime: MissionRuntimeId, sandbox: MissionSandbox, mode?: MissionMode): MayDo {
  const rest = `Anything not listed is left to ${runtimeDisplayName(runtime)}'s own settings.`
  const files = sandbox === 'read-only' ? NO_CHANGES : sandbox === 'workspace-write' ? CHANGES_HERE : CHANGES_ANYWHERE
  const rows = (...own: readonly MayDoRow[]): MayDo => ({ rows: [READ, files, ...own], rest })
  const asks = mode === 'approve-each' && sandbox === 'workspace-write'
  switch (runtime) {
    case 'codex':
      // The sandbox is Codex's own, named in every thread/start: read-only,
      // workspace-write, or danger-full-access for Auto. Approve-each is
      // workspace-write with approval "untrusted", which runs a plain read
      // unasked and asks before anything else (codexAppServerPolicy).
      if (sandbox === 'full-access') return rows(ANY_COMMAND)
      if (asks) {
        return {
          rows: [READ, { verdict: 'allow', text: 'change files in this folder, once you approve each change' }, { verdict: 'allow', text: "run commands in Codex's sandbox, asking you before any that does more than read" }],
          rest
        }
      }
      return rows({
        verdict: 'allow',
        text: sandbox === 'read-only' ? "run commands in Codex's sandbox, which lets them read and change nothing" : "run commands in Codex's sandbox, which keeps their changes in this folder"
      })
    case 'claude':
      // `--tools` is the whole list: Bash only when the mode may edit, and
      // never WebFetch or WebSearch, in any mode (createClaudePrintCommand).
      // Skill, with the folder's skills (and the person's own, when Settings
      // lends them) handed over as plugins (0.679, claude-skills.ts). A skill
      // is instructions: it uses only the tools named above.
      if (sandbox === 'full-access') return rows(ANY_COMMAND)
      return rows(
        sandbox === 'read-only' ? NO_COMMANDS : OPEN_COMMANDS,
        { verdict: 'deny', text: 'searching the web or opening web pages: it is given no tool for either' },
        CLAUDE_SKILLS
      )
    case 'opencode':
      // Read-only: edit, write and patch denied, bash "ask" -- which `run`
      // answers with a refusal every time. Edit: external_directory "deny"
      // and nothing else, so bash, websearch and webfetch run as OpenCode's
      // own defaults have them. Auto: `--auto` and external_directory
      // "allow". No config names the web search in any mode.
      if (sandbox === 'full-access') return rows(ANY_COMMAND)
      if (asks) {
        // `opencode serve` (createOpenCodeServeCommand): edit, bash, webfetch
        // and external_directory all "ask"; websearch is not named.
        return {
          rows: [
            READ,
            { verdict: 'allow', text: 'change files in this folder, once you approve each change' },
            { verdict: 'allow', wide: true, text: 'run commands and open web pages, once you approve each one' },
            { verdict: 'allow', wide: true, text: 'search the web' },
            { verdict: 'allow', wide: true, text: 'open files outside this folder, once you approve it' }
          ],
          rest
        }
      }
      return rows(sandbox === 'read-only' ? NO_COMMANDS : OPEN_COMMANDS, THE_WEB, NOT_OUTSIDE)
    case 'copilot':
      // `--allow-all-tools` in every mode; read-only adds
      // `--deny-tool=write,shell`, and only Auto adds `--allow-all-paths`,
      // so file paths outside the folder are refused otherwise.
      if (sandbox === 'full-access') return rows(ANY_COMMAND)
      if (sandbox === 'read-only') return rows(NO_COMMANDS)
      return rows(OPEN_COMMANDS, NOT_OUTSIDE)
    case 'muse':
      // Read-only: `--disable-write --disable-shell`. Otherwise approval
      // `never` with Muse's sandbox left on ("shell filesystem/network
      // sandboxing", `muse exec --help`) -- which is why Auto is not offered
      // for Muse at all (RUNTIME_CAPABILITIES). Web tools are on unless
      // `--disable-web-tools`, which is never passed; only a mode that never
      // asks is sure to use them.
      if (sandbox === 'read-only') return rows(NO_COMMANDS)
      return { rows: [READ, CHANGES_HERE, { verdict: 'allow', text: "run commands inside Muse's sandbox" }, THE_WEB], rest }
    case 'cursor':
      // Only Auto says anything about commands (`--force`). Read-only is
      // Cursor's own ask mode, with its sandbox where one runs (macOS, Linux).
      return sandbox === 'full-access' ? rows(ANY_COMMAND) : rows()
    case 'antigravity':
      // Through its CLI (0.540, measured): read-only refuses writes and
      // commands, Edit allows file edits and still refuses commands, and only
      // Auto lets it run them.
      return sandbox === 'full-access' ? rows(ANY_COMMAND) : rows()
    case 'gemini':
      // Gemini CLI is refused before anything runs. Nothing to add to the mode itself.
      return rows()
  }
}
