/**
 * A SECRET IN WHAT A TEAMMATE REMEMBERS (0.394).
 *
 * A kept memory is pasted into every teammate's brief, on every runtime and
 * every provider -- free and third-party routes included -- and written to
 * the folder's .locust/memory.md. Until now the only thing standing between
 * a key and all of that was one sentence in the brief ("never secrets,
 * credentials"), which asks the model to behave. This refuses it at the door.
 *
 * The shapes are the ones a key announces itself by, chosen for precision
 * over reach: a false refusal costs a memory, and says why; a missed key
 * would be quietly repeated forever. The list follows agentmemory's
 * privacy.ts (Apache-2.0), reimplemented here from its idea, reviewed
 * read-only on 2026-09-27.
 */
const SHAPES: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'an Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'an OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { kind: 'a GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { kind: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'an npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: 'a signed token (JWT)', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: 'a private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'a bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  // A value written straight after its name: `password=hunter2hunter2`,
  // `api_key: 9f2c...`. Eight characters or more, so a line that only NAMES
  // the setting ("set the password in .env") is not taken for one.
  { kind: 'a password or key', pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"'<>]{8,}/i }
]

/** What kind of secret the text holds, if it holds one. */
export function secretIn(text: string): string | undefined {
  return SHAPES.find((shape) => shape.pattern.test(text))?.kind
}

/**
 * ABOUT YOU, TOO (0.433). The person's note is read by every teammate on
 * every provider, like a memory, and 0.423 left it unguarded. Colin,
 * 2026-09-28, on what memory should refuse: "honestly agents keep personal
 * details about the user to help understand them... maybe just passwords
 * and api keys/stuff like that." So personal details stay welcome; keys do
 * not. `from` names the teammate whose suggested line it was.
 */
export function aboutYouSecretRefusal(kind: string, from?: string): string {
  return from === undefined
    ? `That holds ${kind}, and About you is read by every teammate on every provider, so it was not saved. Keep keys in the runtime's own sign-in or an environment variable.`
    : `A line ${from} suggested for About you held ${kind}, so it was not put to you: About you is read by every teammate on every provider.`
}

/** The refusal, said the way the memory notice says every other one. */
export function secretRefusal(kind: string): string {
  return `It held ${kind}, and a memory is given to every teammate on every provider, so it was not kept. Keep keys in the runtime's own sign-in or an environment variable.`
}
