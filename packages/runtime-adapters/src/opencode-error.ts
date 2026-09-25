/**
 * Saying why OpenCode stopped, when OpenCode said why.
 *
 * MEASURED 2026-09-07, dogfooding on the free model. OpenCode emitted this,
 * and Locust had it in hand the whole time:
 *
 *   {"type":"error","error":{"name":"APIError","data":{
 *      "message":"Error from provider (Console): Rate limit exceeded. Please try again later.",
 *      "statusCode":429,"isRetryable":true,
 *      "responseBody":"{\"type\":\"error\",\"error\":{\"type\":\"FreeUsageLimitError\",...
 *
 * The adapter had no branch for a record of type `error`, so it fell to
 * `opencode.unknown_event` at level `info`, `terminal: false` -- and when the
 * process then exited 1, the person was told:
 *
 *   "OpenCode ended without a step that reported it had stopped."
 *
 * Which is the vaguest available account of something we knew exactly. The
 * mission failed one minute in, on a run that could not have worked, and
 * nothing on screen said the two words that would have explained it: usage
 * limit.
 *
 * The completion path in `opencode-events.ts` already states this rule for the
 * output cap and the confined-workspace refusal -- name what you know, and keep
 * the vague sentence for when you know nothing. This is the same rule applied
 * to the thing the runtime told us in so many words.
 *
 * The sentences below never guess. When there is a provider message it is
 * quoted rather than paraphrased, because a paraphrase of an error is a claim
 * about a system this app cannot see.
 */

import { isObject, stringValue } from "./codex-events.js";

/** Mirrors the private alias in `codex-events.ts`; the shape, not the name, is the contract. */
type JsonObject = Record<string, unknown>;

export interface OpenCodeErrorFacts {
  /** The runtime's own sentence, as it wrote it. */
  readonly message: string | undefined;
  /** HTTP status when the failure came from a provider call. */
  readonly statusCode: number | undefined;
  /** The provider's own error name, e.g. `FreeUsageLimitError`. */
  readonly kind: string | undefined;
  /** Whether OpenCode said trying again could work. */
  readonly retryable: boolean | undefined;
}

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * Pull the facts out of an OpenCode `error` record.
 *
 * The interesting one is buried: the outer `message` says "Rate limit
 * exceeded", which is true of a paid account that has been going too fast AND
 * of a free account that has run out for the day -- two situations with
 * different answers. The `responseBody` is a JSON STRING carrying the
 * provider's own error type, and that is what tells them apart.
 */
export function openCodeErrorFacts(parsed: JsonObject): OpenCodeErrorFacts | undefined {
  const error = isObject(parsed.error) ? parsed.error : undefined;
  if (error === undefined) return undefined;
  const data = isObject(error.data) ? error.data : {};
  let kind = stringValue(data.type) ?? stringValue(error.name);
  const body = stringValue(data.responseBody);
  if (body !== undefined) {
    try {
      const inner: unknown = JSON.parse(body);
      // The body may itself be cut short by whatever recorded it, so this is
      // wrapped: a truncated body must cost the detail, never the whole event.
      if (isObject(inner) && isObject(inner.error)) {
        kind = stringValue(inner.error.type) ?? kind;
      }
    } catch {
      /* a body that will not parse tells us nothing extra, and that is fine */
    }
  }
  return {
    message: stringValue(data.message) ?? stringValue(error.message),
    statusCode: numberValue(data.statusCode),
    kind,
    retryable: typeof data.isRetryable === "boolean" ? data.isRetryable : undefined,
  };
}

/**
 * The sentence a person reads when a run ends on one of these.
 *
 * Two parts, always in this order: what happened, then what to do about it.
 * The second half is only ever written where it is actually known -- a usage
 * limit has a real answer ("wait, or pick another model"), and a generic 500
 * does not, so it gets none rather than a guess.
 */
/**
 * The provider refused to resume this session -- its reasoning was "not
 * issued to this caller" -- so the session is over and the next turn has to
 * start a fresh one. The sentence below promises exactly that (M7).
 */
export function sessionCannotContinue(facts: OpenCodeErrorFacts): boolean {
  return facts.message !== undefined && /encrypted_content/i.test(facts.message);
}

export function openCodeErrorSentence(facts: OpenCodeErrorFacts): string {
  const quoted = facts.message === undefined ? undefined : facts.message.trim();
  // The one worth naming precisely, because it is the one a person meets on
  // their first free run and the wording decides whether they think the app is
  // broken or the model is busy.
  if (facts.kind === "FreeUsageLimitError") {
    return "The free model has no usage left right now, so OpenCode stopped. Pick another model, or try the free one again later.";
  }
  /*
   * The one that actually meets people on the free path, said in words.
   *
   * Grok's beta drive, 2026-09-14, finding 8, on the only route it was
   * allowed to spend: the FIRST turn works, and the second dies with
   *
   *     Upstream request failed: [invalid_request_error] reasoning
   *     `encrypted_content` was not issued to this caller
   *
   * That is the provider refusing to resume a session whose reasoning blocks
   * were issued to someone else -- so the session is gone and the next send
   * starts a new one, which is exactly what a person needs to know and none of
   * what that sentence says. Welcome recommends OpenCode as the no-account
   * path, so this is the error most likely to be somebody's first impression
   * of this app failing.
   *
   * Locust does not cause it and cannot fix it; the CARD is ours.
   */
  if (quoted !== undefined && /encrypted_content/i.test(quoted)) {
    return "OpenCode could not continue this session, so the run stopped. Nothing was lost from the conversation; the next message starts a fresh session.";
  }
  if (facts.statusCode === 429) {
    return `OpenCode was rate limited by the provider and stopped${quoted === undefined ? "" : `: ${quoted}`}`;
  }
  if (facts.statusCode === 401 || facts.statusCode === 403) {
    return `OpenCode was refused by the provider and stopped${quoted === undefined ? "" : `: ${quoted}`}. Its sign-in may have expired -- \`opencode auth login\` in a terminal.`;
  }
  if (quoted !== undefined && quoted.length > 0) {
    return `OpenCode stopped: ${quoted}`;
  }
  return "OpenCode reported an error and stopped, without saying what it was.";
}
