import type { RuntimeCommandSpec } from '@teammate/runtime-adapters'

/**
 * Whether a command will actually fit on a Windows command line.
 *
 * Codex and Claude take the prompt on stdin, where length is not a problem.
 * OpenCode and Copilot take it as an ARGUMENT, and this app reaches both
 * through `cmd.exe /d /s /c <shim>` because npm ships them as `.cmd` shims.
 * `cmd.exe` refuses a command line longer than 8191 characters, and it refuses
 * it in the least helpful way available: exit 1, nothing on stdout, and
 * `The command line is too long.` on stderr, which the thread then reports as
 * the runtime failing.
 *
 * MEASURED 2026-09-05, by growing a prompt against the real CLI:
 *
 *     prompt 7500 -> command line ~7665 -> exit 0, 16 records, result present
 *     prompt 9000 -> command line ~9165 -> exit 1, 0 records,
 *                    "The command line is too long."
 *
 * The app's own bound was 12,000 characters -- comfortably past the cliff --
 * so a long prompt, or an ordinary one plus a workroom briefing, could produce
 * a run that failed for a reason nothing on screen could explain.
 *
 * This is deliberately a CHECK rather than a truncation. Silently cutting a
 * person's prompt to fit would send the runtime a different question than the
 * one they asked and report success; the product's whole posture is that it
 * would rather refuse than quietly do something else.
 */

/**
 * `cmd.exe` stops at 8191. The reserve covers the quoting it applies when it
 * re-parses the line, which inflates any argument containing spaces or quotes
 * -- a prompt contains many of both -- and it is cheap insurance against
 * refusing at 8190 and failing at 8192.
 */
export const WINDOWS_COMMAND_LINE_LIMIT = 8_191
const QUOTING_RESERVE = 1_000

/** How long the line will be once the arguments are joined, roughly. */
export function commandLineLength(spec: RuntimeCommandSpec): number {
  // One space between each part, and the executable itself counts.
  return spec.executablePath.length + spec.args.reduce((total, argument) => total + argument.length + 1, 0)
}

/**
 * The reason this command cannot be run, or undefined when it can.
 *
 * Only applies where the prompt travels in the argument list; a runtime reading
 * stdin has no such ceiling and must not be limited by one.
 */
export function commandTooLong(spec: RuntimeCommandSpec): string | undefined {
  if (spec.stdin !== 'none') return undefined
  const length = commandLineLength(spec)
  if (length + QUOTING_RESERVE <= WINDOWS_COMMAND_LINE_LIMIT) return undefined
  return (
    `This runtime takes the whole request on the command line, and Windows stops at ${String(WINDOWS_COMMAND_LINE_LIMIT)} characters. `
    + `This one came to about ${String(length)}. Shorten the request, or use a runtime that reads it from input — Codex CLI and Claude Code both do.`
  )
}
