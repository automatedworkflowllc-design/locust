/**
 * Conversations by folder (0.458, docs/PLAN-2026-09-29-FOLDERS-LIKE-CLAUDE-CODE.md):
 * the window's folder first, then each other folder by its newest
 * conversation. A row with no folder counts as the window's -- a run still
 * starting belongs where it was started. The window's folder is kept even
 * with nothing in it yet: a folder just switched to.
 */
export function folderSectionsOf<Row extends { readonly folderId?: string; readonly lastAt?: string }>(
  conversations: readonly Row[],
  currentFolderId: string | undefined
): readonly { readonly id: string; readonly missions: readonly Row[] }[] {
  const byFolder = new Map<string, Row[]>()
  const current = currentFolderId ?? ''
  if (currentFolderId !== undefined) byFolder.set(current, [])
  for (const mission of conversations) {
    const id = mission.folderId ?? current
    const list = byFolder.get(id) ?? []
    list.push(mission)
    byFolder.set(id, list)
  }
  const newest = (list: readonly Row[]): string => list.reduce((at, mission) => ((mission.lastAt ?? '') > at ? (mission.lastAt ?? '') : at), '')
  return [...byFolder.entries()]
    .filter(([id, list]) => id === current || list.length > 0)
    .sort(([a, left], [b, right]) => (a === current ? -1 : b === current ? 1 : newest(right).localeCompare(newest(left))))
    .map(([id, missions]) => ({ id, missions }))
}
