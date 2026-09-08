/**
 * Files a person attached to a message, said in a way every runtime can act on.
 *
 * Measured 2026-09-08 (`docs/ATTACHMENTS-INTAKE-2026-09-08.md`): of the six
 * runtimes, three take a file natively (`opencode -f`, `copilot
 * --attachment`, `codex -i` for images) and three take nothing at all. What
 * ALL six can do is read a file inside the workspace, because that is what
 * they are for.
 *
 * So the first version attaches by REFERENCE: the message names the paths and
 * asks the runtime to read them. That is not a stand-in for the real thing --
 * the file genuinely reaches the model, by the runtime's own read, and the
 * read then appears as a tool row in the activity fold. The app can show that
 * it happened instead of claiming it did.
 *
 * Two rules this module exists to keep:
 *
 *   NEVER INLINE THE CONTENTS. A 40 KB paste would eat the prompt budget that
 *   inbound peer messages already lose to (`composeRuntimePrompt` drops a
 *   waiting message when the prompt runs long, measured in its own tests).
 *   A path costs a line.
 *
 *   NEVER CLAIM MORE THAN HAPPENED. The line says "read these files", because
 *   that is what was asked. When step B hands the three capable runtimes the
 *   file natively, the wording for those changes to match.
 */

/** The most files one message may carry. */
export const MAX_ATTACHMENTS = 8

/**
 * The line that goes above the person's own words.
 *
 * Above, not below: the runtime should know what it is working from before it
 * reads the request. Returns undefined for no attachments, so a caller cannot
 * accidentally prepend an empty instruction.
 */
export function attachmentPreamble(paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined
  const listed = paths.map((path) => `- ${path}`).join('\n')
  return paths.length === 1
    ? `Read this file in the workspace before you answer:\n${listed}`
    : `Read these ${String(paths.length)} files in the workspace before you answer:\n${listed}`
}

/** The prompt actually sent: the preamble, a blank line, then what was typed. */
export function withAttachments(prompt: string, paths: readonly string[]): string {
  const preamble = attachmentPreamble(paths)
  return preamble === undefined ? prompt : `${preamble}\n\n${prompt}`
}

/**
 * What the composer chip says.
 *
 * Deliberately "1 file" rather than "attached": on five of six runtimes
 * nothing is attached in the API sense, and a word that overstates what
 * happened is the thing this app keeps refusing to do.
 */
export function attachmentLabel(count: number): string {
  return count === 1 ? '1 file' : `${String(count)} files`
}
