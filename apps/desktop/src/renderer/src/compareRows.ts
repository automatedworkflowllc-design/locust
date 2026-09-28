import type { PublicCompare } from '../../shared/compare.js'

/**
 * A COMPARISON IS ONE ROW IN THE SIDEBAR (0.441, shared/compare.ts).
 *
 * Every column is its own mission, so the sidebar would list a comparison of
 * three models as three conversations with one title. It lists one: until a
 * column is kept, the first column's row stands for the comparison and opens
 * it; once one is kept, the kept column's row is an ordinary conversation and
 * the others are only reached through it ("Open the comparison").
 */
export function foldComparisons<T extends { readonly missionId: string; readonly memberIds?: readonly string[] }>(
  rows: readonly T[],
  compares: readonly PublicCompare[]
): (T & { readonly compareId?: string })[] {
  const out: (T & { readonly compareId?: string })[] = []
  for (const row of rows) {
    const members = row.memberIds ?? [row.missionId]
    const found = compares
      .map((compare) => ({ compare, column: compare.slots.find((column) => column.missionIds.some((id) => members.includes(id))) }))
      .find((match) => match.column !== undefined)
    if (found === undefined || found.column === undefined) {
      out.push(row)
      continue
    }
    const visible = found.compare.kept?.slot ?? found.compare.slots.find((column) => column.missionIds.length > 0)?.slot
    if (found.column.slot !== visible) continue
    out.push(found.compare.kept === undefined ? { ...row, compareId: found.compare.compareId } : row)
  }
  return out
}

/** The comparison a conversation came from, found through any of its turns. */
export function comparisonOf(memberIds: readonly string[], compares: readonly PublicCompare[]): PublicCompare | undefined {
  return compares.find((compare) => compare.slots.some((column) => column.missionIds.some((id) => memberIds.includes(id))))
}
