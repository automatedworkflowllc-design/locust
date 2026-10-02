/**
 * COMPARE (0.441, docs/PLAN-2026-09-28-COMPARE.md): one ask, two or three
 * models, side by side; the person keeps one.
 *
 * Colin, 2026-09-28: "whats the best way to implement a "compare" mode, maybe
 * a side by side or a room where you can compare work between different
 * models like fable/astra". His bar the same day: "if we cant make it clean
 * and seamless, we dont do it".
 *
 * Phase one compares ANSWERS: every column runs read-only, so it works in any
 * folder and nothing can collide. Each column is its own mission (its own
 * session), started in a teammate's conversation with only the route changed,
 * and recorded here -- outside the mission ledger, like a room -- so the
 * columns come back after a restart.
 */
export const MAX_COMPARE_SLOTS = 3
export const MIN_COMPARE_SLOTS = 2
export const COMPARE_SLOTS = ['a', 'b', 'c'] as const
export type CompareSlotId = (typeof COMPARE_SLOTS)[number]

export interface CompareRoute {
  readonly runtime: string
  readonly model: string
  readonly effort?: string
  /** The name the picker showed, so a column keeps its name after a restart. */
  readonly label?: string
  /**
   * A comparison that edits runs this column in Auto when it can (0.451).
   * Colin, 2026-09-28, after a three-way comparison sat on seven approvals:
   * "shouldnt we just have compare mode run automatically on auto, cause
   * lowkey this is a disaster rn managing all those approvals". Each column
   * works in its own copy, so Auto there reaches no file of the person's.
   */
  readonly mode?: 'auto'
}

export interface PublicCompareSlot {
  readonly slot: CompareSlotId
  readonly route: CompareRoute
  /** One per turn in this column, oldest first. */
  readonly missionIds: readonly string[]
  /** Why this column could not start, when it could not. */
  readonly refused?: string
  /**
   * Answers that were tried again (0.444): still this comparison's, so they
   * never surface as conversations of their own, but no longer drawn.
   */
  readonly retried?: readonly string[]
}

export interface PublicCompare {
  readonly compareId: string
  /** Whose conversation it was started in; absent for nobody's -- no teammate is needed to compare. */
  readonly teammateId?: string
  /** What the person asked first: the comparison's name. */
  readonly prompt: string
  readonly createdAt: string
  readonly slots: readonly PublicCompareSlot[]
  /**
   * Each model changes its own copy of the project (0.445), rather than only
   * answering. Only in a git project; Keep this one then puts the kept copy's
   * changes into the folder.
   */
  readonly changes?: true
  /**
   * Where a comparison that edits keeps its columns' copies (0.448): 'copy'
   * is a plain copy of a folder that is not a git project; absent, each
   * column is a git worktree.
   */
  readonly changesIn?: 'copy'
  /**
   * The names are hidden until one is kept (0.449, Arena's Battle): columns
   * read Model A, Model B, so the answer is judged and not the name.
   */
  readonly blind?: true
  /**
   * The column the person kept; the conversation carries on from its newest
   * mission. `brought` names the files its changes put into the folder, in a
   * comparison that edits.
   */
  readonly kept?: { readonly slot: CompareSlotId; readonly at: string; readonly brought?: readonly string[] }
  /**
   * A judge's view, when the person asked for one (0.520, after Artificial
   * Analysis's Optima): a model of their choosing read the answers under
   * blind letters and said what each did and which it would keep. It never
   * keeps one itself. `missionIds` are its runs, newest last -- the newest is
   * shown; every one is the comparison's, never a conversation of its own.
   */
  readonly judge?: { readonly route: CompareRoute; readonly missionIds: readonly string[]; readonly criteria?: string }
}

/** How long "what a good answer does" may be, as the person writes it for a judge. */
export const MAX_JUDGE_CRITERIA = 1_000

/** Every judge's run, so the sidebar and the history never list one as a conversation (0.520). */
export function judgeMissionIds(compares: readonly PublicCompare[]): ReadonlySet<string> {
  return new Set(compares.flatMap((compare) => compare.judge?.missionIds ?? []))
}

/** The run slot a column holds, so one teammate can run on two models at once. */
export function compareSlotKey(teammateId: string | undefined, compareId: string, slot: CompareSlotId): string {
  return `${teammateId ?? 'nobody'}#${compareId}/${slot}`
}

/** Where a comparison's copies live under the folder (0.445): never among the teammates' own branches. */
export const COMPARE_TREES_DIRECTORY = '.locust/compare'

/** The copy a column of a comparison that edits works in: `cmp_x-a`. */
export function compareTreeId(compareId: string, slot: CompareSlotId): string {
  return `${compareId}-${slot}`
}

/** "+12 -3 in 2 files", or what a column that changed nothing says. */
export function changesLine(changes: { readonly files: number; readonly added?: number; readonly removed?: number }): string {
  if (changes.files === 0) return 'no changes'
  if (changes.added === undefined || changes.removed === undefined) return `${String(changes.files)} ${changes.files === 1 ? 'file' : 'files'} changed`
  return `+${String(changes.added)} \u2212${String(changes.removed)} in ${String(changes.files)} ${changes.files === 1 ? 'file' : 'files'}`
}

/**
 * The comparisons whose every answer is gone for good (0.445): emptying the
 * trash takes them, and the copies they held, with it. One with any answer
 * still kept -- in the conversation list or in the trash still -- stays.
 */
export function comparesGoneWith(compares: readonly PublicCompare[], gone: ReadonlySet<string>): readonly PublicCompare[] {
  return compares.filter((compare) => {
    const ids = compare.slots.flatMap((column) => [...column.missionIds, ...(column.retried ?? [])])
    return ids.length > 0 && ids.every((id) => gone.has(id))
  })
}

/** Every mission that belongs to a comparison, and the one kept (drawn as an ordinary conversation). */
export function compareMembership(compares: readonly PublicCompare[]): {
  readonly byMission: ReadonlyMap<string, { readonly compareId: string; readonly slot: CompareSlotId }>
} {
  const byMission = new Map<string, { compareId: string; slot: CompareSlotId }>()
  for (const compare of compares) {
    for (const slot of compare.slots) {
      for (const missionId of [...(slot.retried ?? []), ...slot.missionIds]) byMission.set(missionId, { compareId: compare.compareId, slot: slot.slot })
    }
  }
  return { byMission }
}

/**
 * Whether a column answers in a copy of the folder rather than the folder
 * itself (0.443). A comparison answers read-only, and Cursor cannot be held
 * read-only on Windows -- which kept Grok and Gemini, reached through Cursor,
 * out of every comparison (Colin, 2026-09-28: "gemini/grok not selectable on
 * compare?"). In a copy it runs as it can, and the folder is untouched.
 */
export function compareNeedsCopy(_runtime: string, _platform: string | undefined): boolean {
  /*
   * NONE NOW (0.485). Cursor answers read-only on Windows in its own ask mode
   * (commands.ts cursorCanEnforceReadOnly), so an answers-only comparison runs
   * it in the folder itself, like every other column. The copy it needed made
   * Grok "could not start" in any folder over 5,000 files or 250 MB (Colin,
   * 2026-09-30, comparing in his .claude folder). Kept as the one place to say
   * so if a runtime ever needs a copy again.
   */
  return false
}

/** A runtime that cannot join a comparison at all, and why; undefined when it can. */
export function compareRefusalOf(runtime: string, antigravityCli = false): string | undefined {
  // Through Antigravity CLI it answers in any folder, like every other column (0.543).
  if (runtime === 'antigravity' && !antigravityCli) return 'Through its app, Antigravity answers only in the folder it has open, so it cannot answer in a comparison. Install Antigravity CLI and it can.'
  return undefined
}

/**
 * YOUR OWN LEADERBOARD (0.449, after Arena's). Every Keep is a vote: for each
 * model, how many of your DECIDED comparisons it answered in, and how many of
 * those you kept it. Local only -- it is your record, not the world's -- and
 * a column that never answered, or a comparison not yet decided, counts for
 * nothing. Keyed `runtime:model`, the picker's own key.
 */
export function compareRecord(compares: readonly PublicCompare[]): ReadonlyMap<string, { readonly kept: number; readonly compared: number }> {
  const record = new Map<string, { kept: number; compared: number }>()
  for (const compare of compares) {
    if (compare.kept === undefined) continue
    for (const column of compare.slots) {
      if (column.missionIds.length === 0) continue
      const key = `${column.route.runtime}:${column.route.model}`
      const entry = record.get(key) ?? { kept: 0, compared: 0 }
      entry.compared += 1
      if (column.slot === compare.kept.slot) entry.kept += 1
      record.set(key, entry)
    }
  }
  return record
}

/** A column's name while a blind comparison is undecided: "Model A". */
export function blindName(slot: CompareSlotId): string {
  return `Model ${slot.toUpperCase()}`
}

/** "Fable 5.1 vs GPT-6 Astra", "A vs B vs C". */
export function versusLabel(names: readonly string[]): string {
  return names.join(' vs ')
}

/**
 * WHICH ANSWER THE JUDGE WOULD KEEP (0.554), so the comparison can mark that
 * column. The judge is asked to end on which answer it would keep
 * (compare-judge.ts); Cursor's, on 0.553: "I would keep Answer C, because
 * ...". The last "keep Answer X" counts. Undefined when it named none, one it
 * would not keep, or one not in this comparison -- then nothing is marked,
 * and its words still say what it said.
 */
export function judgePickOf(text: string, slots: readonly CompareSlotId[]): CompareSlotId | undefined {
  const picks = [...text.matchAll(/(\bnot\s+|n't\s+)?\bkeep:?[\s*_]*answer\s+([a-c])\b/gi)]
  const last = picks.at(-1)
  if (last === undefined || last[1] !== undefined) return undefined
  const letter = last[2]?.toLowerCase()
  return slots.find((slot) => slot === letter)
}
