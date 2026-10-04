/**
 * Which `.cursorignore` rule hides a path from Cursor, if one does.
 *
 * THREE incidents on this machine, and the cost is always the same: Cursor's
 * file tools refuse a path and say only "permission denied", so the model
 * invents a reason and the person chases the invention.
 *
 *   2026-09-07  `AppData/`   every scratch workspace -- ten red checks in
 *                            diff-smoke that all described a diff-rendering
 *                            defect in a run that was never allowed to open
 *                            the file.
 *   2026-09-11  `.codex/`    the agent worktrees. Shell worked, Read did not.
 *                            Colin: "cant read locust astra worktree".
 *   2026-09-12  `.claude/`   Locust's OWN attachments, inside a workspace
 *                            Locust had just written them to. The teammate:
 *                            "this worker cannot open them -- Read returns
 *                            permission denied even after copying to temp",
 *                            and then a paragraph of invented explanation.
 *
 * Locust can see this before the run does, and a sentence naming the rule
 * replaces an afternoon. That is the whole reason this exists.
 *
 * WHAT IT CHECKS, and what it does not. Directory rules only, in the two
 * shapes these files carry: `name/` and `name/*`. The second matters because
 * it is the shape you MUST use to re-include anything -- gitignore syntax
 * cannot negate inside an excluded directory -- so every fix to one of these
 * incidents produced a rule the old matcher could no longer see. A `!`
 * negation for the same path cancels a hit, because that is exactly what the
 * fixes look like.
 *
 * A quiet return means "no directory rule matched", NEVER "Cursor can
 * certainly see this": file globs are not read here. It is a reason to
 * suspect, not a proof of access.
 */

export interface CursorIgnoreHit {
  /** The rule line, as written, so a person can find it in the file. */
  readonly rule: string
  /** The directory it names, for the sentence. */
  readonly directory: string
  /**
   * Whether the rule is already the `dir/*` shape.
   *
   * It decides the advice, and getting it wrong produced a sentence that told
   * Colin to change `.claude/*` to `.claude/*` -- which is the kind of thing
   * that makes a person stop believing the rest of the message.
   */
  readonly alreadyNarrowed: boolean
}

interface Rule {
  readonly line: string
  readonly name: string
  /** The path under it that a `!` line brought back, if any. */
  readonly negated: boolean
  /** `name/*` rather than `name/`, which changes what there is left to advise. */
  readonly narrowed: boolean
}

/*
 * Either separator, with the backslash written as a unicode escape on
 * purpose.
 *
 * The obvious spelling is a character class holding a backslash and a
 * slash, and it is how this was first written -- except a shell ate one
 * level on the way to disk and left a class matching FORWARD SLASH ONLY.
 * Every fixture here used forward slashes, so seven tests passed over a
 * matcher that could not split a single real Windows path, and the notice
 * it feeds would never once have fired. The repo's own
 * `escapes-survived-the-shell` guard caught it.
 *
 * So: no backslash literal to lose. `\u005c` is a backslash and cannot be
 * quietly halved.
 */
const NAMES = /[/\u005c]+/

function ruleOf(line: string): Rule | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) return undefined
  const negated = trimmed.startsWith('!')
  const body = (negated ? trimmed.slice(1) : trimmed).replace(/^\*\*\//, '')
  // `name/` and `name/*` are the two directory shapes. Anything else -- a
  // bare name, a glob over files -- is outside what this claims to read.
  const match = /^(.+?)\/(\*)?$/.exec(body)
  if (match === null) return undefined
  const name = match[1] ?? ''
  return name.length === 0 ? undefined : { line: trimmed, name, negated, narrowed: match[2] === '*' }
}

export function cursorIgnoreHit(path: string, ignoreText: string): CursorIgnoreHit | undefined {
  const segments = path.split(NAMES).filter((part) => part.length > 0)
  let hit: CursorIgnoreHit | undefined
  for (const raw of ignoreText.split('\n')) {
    const rule = ruleOf(raw)
    if (rule === undefined) continue
    // The rule may name a path (`.cursor/projects/`) or a single directory
    // (`node_modules/`); both are a hit when every part of it is on this path
    // in order.
    const wanted = rule.name.split(NAMES).filter((part) => part.length > 0)
    if (!containsInOrder(segments, wanted)) continue
    // Later rules win, which is gitignore's own rule and is how a fix is
    // written: the exclusion first, the re-inclusion after it.
    hit = rule.negated ? undefined : { rule: rule.line, directory: rule.name, alreadyNarrowed: rule.narrowed }
  }
  return hit
}

/** Whether `wanted` appears as consecutive segments of `segments`. */
function containsInOrder(segments: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.length === 0 || wanted.length > segments.length) return false
  for (let start = 0; start + wanted.length <= segments.length; start += 1) {
    let all = true
    for (let index = 0; index < wanted.length; index += 1) {
      if (segments[start + index] !== wanted[index]) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

/**
 * The sentence a person can act on.
 *
 * It names the rule and the file, because "Cursor cannot read this folder" on
 * its own is the same dead end the runtime already produces.
 */
export function cursorIgnoreSentence(hit: CursorIgnoreHit, ignorePath: string): string {
  const said = `Cursor cannot read files here: ${ignorePath} hides this folder with the rule "${hit.rule}". Its tools will answer "permission denied" and give no reason.`
  // Two different situations, and one piece of advice cannot serve both. A
  // bare `dir/` cannot be negated at all, so the rule itself has to change; a
  // `dir/*` already can be, so what is missing is the line that lets this
  // folder back in. 0.87.0 gave the first advice in both cases and told
  // Colin to change ".claude/*" to ".claude/*".
  return hit.alreadyNarrowed
    ? `${said} Add "!${hit.directory}/<the folder you need>" beneath that rule, or remove it.`
    : `${said} Change that rule to "${hit.directory}/*" and add "!${hit.directory}/<the folder you need>" beneath it, or remove it.`
}
