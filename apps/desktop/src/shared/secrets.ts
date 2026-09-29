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
  { kind: 'a password or key', pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"'<>]{8,}/i },
  /*
   * QA-2026-09-29 round 2, R2: what the shapes above let through, found by
   * writing secrets the way people say them.
   */
  // `postgres://admin:hunter2@db.internal/app` -- a login inside an address.
  { kind: 'a login inside an address', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i },
  // An AWS secret access key: 40 characters of base64 near the word that names it.
  { kind: 'an AWS secret key', pattern: /\b(?:secret|aws)\b[^\n]{0,60}?(?<![A-Za-z0-9/+])(?=[A-Za-z0-9/+]*[0-9/+])(?=[A-Za-z0-9/+]*[a-z])(?=[A-Za-z0-9/+]*[A-Z])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/i },
  // A passphrase said, whatever it is: "the ssh key passphrase is correct horse battery staple".
  { kind: 'a passphrase', pattern: /\bpassphrase\b[^.\n]{0,30}?\b(?:is|was)\s*[:=]?\s*\S{3,}|\bpassphrase\s*[:=]\s*\S{3,}/i }
]

/**
 * Said in words, a password is only one when its value looks like one: "the
 * password is hunter2hunter2" and "the admin login is admin / P@ssw0rd-2026!"
 * are refused, "the password is stored in the vault" is not (R2). A value
 * that looks like one holds a digit or a symbol and is six characters or more.
 */
const LOOKS_LIKE_A_PASSWORD = (value: string): boolean => value.length >= 6 && /[0-9!@#$%^&*_+=?~-]/.test(value) && !/^\.[A-Za-z]+$/.test(value)
function passwordSaid(text: string): boolean {
  for (const said of text.matchAll(/\b(?:password|passwd|pwd|pin)\b[^.\n]{0,30}?\b(?:is|was)\s+["'`]?([^\s"'`]+)/gi)) {
    if (LOOKS_LIKE_A_PASSWORD((said[1] ?? '').replace(/[.,;)]+$/, ''))) return true
  }
  for (const said of text.matchAll(/\b(?:login|logins|credentials?|username)\b[^\n]{0,40}?\S+\s*[/:]\s*([^\s"'`]+)/gi)) {
    if (LOOKS_LIKE_A_PASSWORD((said[1] ?? '').replace(/[.,;)]+$/, ''))) return true
  }
  return false
}

/**
 * A payment card number: 13 to 19 digits, spaced or not, that pass the Luhn
 * check every card number carries (R10). Personal details stay welcome --
 * Colin, 2026-09-28, scoped this refusal to "passwords and api keys/stuff
 * like that" -- so a phone number is kept; a card number is a key to money.
 */
function cardNumberIn(text: string): boolean {
  for (const run of text.matchAll(/(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])/g)) {
    const digits = run[0].replace(/[^0-9]/g, '')
    let sum = 0
    for (let at = 0; at < digits.length; at += 1) {
      let digit = Number(digits[digits.length - 1 - at])
      if (at % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2
      sum += digit
    }
    // Luhn alone passes one long number in ten -- an order id, a timestamp --
    // so the number must also open the way a card network's do.
    const network = /^(?:4|5[1-5]|2[2-7]|3[47]|6(?:011|5))/.test(digits)
    if (sum % 10 === 0 && network && !/^(\d)\1+$/.test(digits)) return true
  }
  return false
}

/** What kind of secret the text holds, if it holds one. */
export function secretIn(text: string): string | undefined {
  const shape = SHAPES.find((candidate) => candidate.pattern.test(text))?.kind
  if (shape !== undefined) return shape
  if (passwordSaid(text)) return 'a password'
  if (cardNumberIn(text)) return 'a card number'
  return undefined
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
