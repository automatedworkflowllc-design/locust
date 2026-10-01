/**
 * SAVED APPROVAL RULES (0.521), the evaluator. Product ideas (Bloks note,
 * item 1): an approval card's "Always" becomes a rule a person can see as a
 * sentence and remove, scoped to a teammate and a folder. Copied from Claude
 * Code's own permission rules where they fit: `Bash(npm run test:*)` is a
 * command prefix, `Edit(src/**)` a path pattern, and deny always wins.
 *
 * This file only DECIDES; nothing here runs, writes or answers a card. It is
 * a security surface, so its rules are narrow on purpose:
 *
 *   - Deny is checked first and wins over any allow.
 *   - An allow on a command covers ONE simple command: never one carrying
 *     `;` `&&` `||` `|` `&` `$(` a backtick, a redirect or a newline. Such a
 *     command still asks, whatever the rules say. A deny, though, matches
 *     any simple part of a compound command -- `ls; rm -rf x` is denied by
 *     a rule denying `rm`.
 *   - A path rule matches only paths inside the folder the rule is scoped
 *     to, relative to it; `..`, another drive or an absolute path elsewhere
 *     is never allowed by a rule.
 *   - A question to the person is never governed: it always asks.
 *   - No rule, or anything this cannot read: ask.
 */

export type RuleEffect = 'allow' | 'deny'
/** What a rule is about: a shell command, a file edited, a file read, a connector's tool. */
export type RuleKind = 'command' | 'edit' | 'read' | 'connector'

export interface ApprovalRule {
  readonly ruleId: string
  readonly effect: RuleEffect
  readonly kind: RuleKind
  /**
   * command: the exact command, or a prefix ending in `:*` ("npm run test:*").
   * edit/read: a path pattern relative to the folder; `*` is any name, `**`
   * any depth ("src/**", "docs/*.md").
   * connector: "server" for any of its tools, or "server/tool".
   */
  readonly pattern: string
  /** Only for this teammate; absent, any teammate. */
  readonly teammateId?: string
  /** Only in this folder (an absolute path); absent, any folder. */
  readonly folder?: string
  readonly createdAt: string
}

/** One thing a runtime asked to do, as the evaluator reads it. */
export type RuledAction =
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'edit' | 'read'; readonly paths: readonly string[] }
  | { readonly kind: 'connector'; readonly server: string; readonly tool: string }
  /** A question to the person, or anything else: never governed. */
  | { readonly kind: 'other' }

export interface RuleContext {
  readonly teammateId?: string
  /** The folder the run works in, absolute. */
  readonly folder?: string
}

export type RuleVerdict =
  | { readonly decision: 'allow' | 'deny'; readonly rule: ApprovalRule }
  | { readonly decision: 'ask'; readonly why?: string }

/** Characters that make a command more than one simple command. */
const COMPOUND = /;|&&|\|\||\||&|\$\(|`|>|<|\r|\n/

export const COMPOUND_REFUSAL = 'It is more than one simple command, so no saved rule allows it.'

const flat = (command: string): string => command.trim().replace(/\s+/g, ' ')

/** A command's simple parts, for deny: split on the operators, each part trimmed. */
function simpleParts(command: string): readonly string[] {
  return command
    .split(/;|&&|\|\||\||&|\r|\n|\$\(|`|\)/)
    .map((part) => flat(part.replace(/[<>].*$/, '')))
    .filter((part) => part.length > 0)
}

function commandMatches(pattern: string, command: string): boolean {
  const want = flat(pattern)
  const have = flat(command)
  if (want.length === 0 || have.length === 0) return false
  if (want.endsWith(':*')) {
    const prefix = want.slice(0, -2).trimEnd()
    // A prefix is whole words: "npm run test:*" covers "npm run test -- x", never "npm run tests".
    return prefix.length > 0 && (have === prefix || have.startsWith(`${prefix} `))
  }
  return have === want
}

/** Normalised, forward slashes, no trailing slash, case kept. */
const slashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * A path relative to the folder, or undefined when it is not inside it.
 * Windows paths compare without case, as the file system does.
 */
export function insideFolder(path: string, folder: string): string | undefined {
  const base = slashes(folder)
  const raw = slashes(path)
  const absolute = /^[A-Za-z]:\//.test(raw) || raw.startsWith('/')
  const joined = absolute ? raw : `${base}/${raw}`
  // Resolve . and .. by hand; a path that climbs above the folder is not inside it.
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' && parts.length > 0) continue
    if (part === '.') continue
    if (part === '..') {
      if (parts.length <= 1) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const resolved = parts.join('/')
  const windows = /^[A-Za-z]:/.test(base)
  const same = (left: string, right: string): boolean => (windows ? left.toLowerCase() === right.toLowerCase() : left === right)
  if (!same(resolved.slice(0, base.length), base)) return undefined
  const rest = resolved.slice(base.length)
  if (rest.length === 0) return ''
  if (!rest.startsWith('/')) return undefined
  return rest.slice(1)
}

function globToRegExp(pattern: string): RegExp {
  let out = ''
  const text = slashes(pattern).replace(/^\.\//, '')
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string
    if (character === '*') {
      if (text[index + 1] === '*') {
        // "**/" is any depth, including none; a bare "**" is anything.
        if (text[index + 2] === '/') {
          out += '(?:.*/)?'
          index += 2
        } else {
          out += '.*'
          index += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (character === '?') {
      out += '[^/]'
    } else {
      out += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`, 'i')
}

function pathMatches(pattern: string, relative: string): boolean {
  return globToRegExp(pattern).test(relative)
}

function scoped(rule: ApprovalRule, context: RuleContext): boolean {
  if (rule.teammateId !== undefined && rule.teammateId !== context.teammateId) return false
  if (rule.folder !== undefined) {
    if (context.folder === undefined) return false
    if (insideFolder(context.folder, rule.folder) !== '') return false
  }
  return true
}

/** Whether a rule speaks to this action, deny reading compound commands part by part. */
function matches(rule: ApprovalRule, action: RuledAction, context: RuleContext): boolean {
  if (rule.kind !== action.kind) return false
  if (action.kind === 'command') {
    if (rule.effect === 'deny') return [flat(action.command), ...simpleParts(action.command)].some((part) => commandMatches(rule.pattern, part))
    return !COMPOUND.test(action.command) && commandMatches(rule.pattern, action.command)
  }
  if (action.kind === 'edit' || action.kind === 'read') {
    const folder = rule.folder ?? context.folder
    if (folder === undefined || action.paths.length === 0) return false
    const relative = action.paths.map((path) => insideFolder(path, folder))
    // Deny: any path it names. Allow: every path inside the folder, and every one matching.
    if (rule.effect === 'deny') return relative.some((path) => path !== undefined && pathMatches(rule.pattern, path)) || action.paths.some((path) => pathMatches(rule.pattern, slashes(path)))
    return relative.every((path) => path !== undefined && path.length > 0 && pathMatches(rule.pattern, path))
  }
  if (action.kind === 'connector') {
    const [server, tool] = rule.pattern.split('/')
    return server === action.server && (tool === undefined || tool === action.tool)
  }
  return false
}

export function decideByRules(action: RuledAction, rules: readonly ApprovalRule[], context: RuleContext): RuleVerdict {
  if (action.kind === 'other') return { decision: 'ask' }
  const applicable = rules.filter((rule) => scoped(rule, context))
  const denied = applicable.find((rule) => rule.effect === 'deny' && matches(rule, action, context))
  if (denied !== undefined) return { decision: 'deny', rule: denied }
  const allowed = applicable.find((rule) => rule.effect === 'allow' && matches(rule, action, context))
  if (allowed !== undefined) return { decision: 'allow', rule: allowed }
  if (action.kind === 'command' && COMPOUND.test(action.command) && applicable.some((rule) => rule.effect === 'allow' && rule.kind === 'command' && commandMatches(rule.pattern, simpleParts(action.command)[0] ?? ''))) {
    return { decision: 'ask', why: COMPOUND_REFUSAL }
  }
  return { decision: 'ask' }
}

/** A rule as a person reads it, on the card and in Settings. */
export function ruleSentence(rule: ApprovalRule, teammateName?: string): string {
  const who = rule.teammateId === undefined ? 'Any teammate' : teammateName ?? 'This teammate'
  const verb = rule.effect === 'allow' ? 'may' : 'may not'
  const what =
    rule.kind === 'command'
      ? rule.pattern.endsWith(':*')
        ? `run commands starting "${rule.pattern.slice(0, -2).trim()}"`
        : `run "${rule.pattern}"`
      : rule.kind === 'edit'
        ? `change files matching ${rule.pattern}`
        : rule.kind === 'read'
          ? `read files matching ${rule.pattern}`
          : rule.pattern.includes('/')
            ? `use ${rule.pattern.split('/')[1] ?? ''} on ${rule.pattern.split('/')[0] ?? ''}`
            : `use the ${rule.pattern} connector`
  const where = rule.folder === undefined ? '' : ` in ${slashes(rule.folder).split('/').pop() ?? rule.folder}`
  // An allow is about not being asked; a deny is a plain no.
  return `${who} ${verb} ${what}${where}${rule.effect === 'allow' ? ' without asking' : ''}.`
}
