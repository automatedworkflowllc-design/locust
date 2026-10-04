/**
 * THE EXACT ACTION, WHOLE (QA-2026-09-29 round 2, R14).
 *
 * An approval card is headed "exact action", and it showed the first 600
 * characters of a Claude tool call's input (4,000 of a Codex command), cut
 * mid-word, flattened to one line, with nothing counting what was left out --
 * while Approve let the whole of it through. A mail's recipient written last
 * in its input appeared nowhere on the card, and the field order is the
 * model's to choose, so text it read can put the part that matters past the
 * cut.
 *
 * So the whole of it is shown: line breaks kept (the field wraps and scrolls),
 * a connector's input set out one field to a line. Past a size no real call
 * reaches, the rest is COUNTED, never silently dropped.
 */
export const MAX_APPROVAL_DETAIL = 20_000

export function wholeDetail(text: string): string {
  const kept = text.replace(/\r\n?/g, '\n').trim()
  if (kept.length <= MAX_APPROVAL_DETAIL) return kept
  const rest = kept.length - MAX_APPROVAL_DETAIL
  return `${kept.slice(0, MAX_APPROVAL_DETAIL)}\n\n[${rest.toLocaleString('en-US')} more character${rest === 1 ? '' : 's'} not shown here. Deny if you cannot see enough to decide.]`
}

/** A tool call's input, one field to a line, so every field is on the card. */
export function wholeInput(input: unknown): string {
  try {
    return wholeDetail(JSON.stringify(input, null, 2) ?? '')
  } catch {
    return ''
  }
}
