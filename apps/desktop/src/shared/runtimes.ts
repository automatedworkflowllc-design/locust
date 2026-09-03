import type { MissionRuntimeId } from '@teammate/runtime-adapters'

/**
 * Runtime identity, in one place. Every runtime discovery knows how to find is
 * a mission runtime; which of them the host can actually RUN a mission under is
 * a narrower fact, decided by whether its event stream has been measured.
 */

const DISPLAY_NAMES: Readonly<Record<MissionRuntimeId, string>> = {
  codex: 'Codex CLI',
  claude: 'Claude Code',
  cursor: 'Cursor Agent',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  copilot: 'Copilot CLI',
  antigravity: 'Antigravity'
}

export function isMissionRuntime(value: unknown): value is MissionRuntimeId {
  return typeof value === 'string' && Object.hasOwn(DISPLAY_NAMES, value)
}

export function runtimeDisplayName(runtime: MissionRuntimeId): string {
  return DISPLAY_NAMES[runtime]
}

/**
 * The runtimes whose event streams the host has a normalizer for, each built
 * from fixtures measured off the real CLI. Gemini CLI is found and signed
 * into like the others, but its stream has never been captured (Google now
 * refuses the CLI to consumer accounts), so a mission under it would be a
 * process whose output nobody can read -- and it is refused, by name, before
 * anything is recorded.
 */
export function hostReadsEventsOf(runtime: MissionRuntimeId): runtime is 'codex' | 'claude' | 'cursor' | 'opencode' | 'copilot' {
  return runtime === 'codex' || runtime === 'claude' || runtime === 'cursor' || runtime === 'opencode' || runtime === 'copilot'
}

/**
 * Whether the host can own a mission under this runtime at all. Five stream
 * their events through a process the host reads; Antigravity is driven
 * through its own running app and watched through a transcript file, which
 * is a different transport with the same receipts -- so it can run a mission
 * without being one the process runner reads.
 */
export function hostCanRunMission(runtime: MissionRuntimeId): boolean {
  return hostReadsEventsOf(runtime) || runtime === 'antigravity'
}
