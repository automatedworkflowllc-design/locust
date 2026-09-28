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
   * The column the person kept; the conversation carries on from its newest
   * mission. `brought` names the files its changes put into the folder, in a
   * comparison that edits.
   */
  readonly kept?: { readonly slot: CompareSlotId; readonly at: string; readonly brought?: readonly string[] }
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
export function changesLine(changes: { readonly files: number; readonly added: number; readonly removed: number }): string {
  if (changes.files === 0) return 'no changes'
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
export function compareNeedsCopy(runtime: string, platform: string | undefined): boolean {
  return runtime === 'cursor' && platform === 'win32'
}

/** A runtime that cannot join a comparison at all, and why; undefined when it can. */
export function compareRefusalOf(runtime: string): string | undefined {
  if (runtime === 'antigravity') return 'Antigravity answers only in the folder it has open, so it cannot answer in a comparison.'
  return undefined
}

/** "Fable 5.1 vs GPT-6 Astra", "A vs B vs C". */
export function versusLabel(names: readonly string[]): string {
  return names.join(' vs ')
}
