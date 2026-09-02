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
  gemini: 'Gemini CLI'
}

export function isMissionRuntime(value: unknown): value is MissionRuntimeId {
  return typeof value === 'string' && Object.hasOwn(DISPLAY_NAMES, value)
}

export function runtimeDisplayName(runtime: MissionRuntimeId): string {
  return DISPLAY_NAMES[runtime]
}

/**
 * The runtimes whose event streams the host has a normalizer for, each built
 * from fixtures measured off the real CLI. Cursor Agent and Gemini CLI are
 * found and signed into like the others, but a mission under either would be
 * a process whose output nobody can read yet -- so it is refused, by name,
 * before anything is recorded.
 */
export function hostReadsEventsOf(runtime: MissionRuntimeId): runtime is 'codex' | 'claude' {
  return runtime === 'codex' || runtime === 'claude'
}
