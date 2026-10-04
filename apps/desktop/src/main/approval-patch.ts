import { toolPatchFrom } from '@teammate/runtime-adapters'
import type { ToolPatch } from '@teammate/runtime-adapters'

import { unifiedPatchText } from '../shared/approval-patch.js'
import type { FileChangeRecord } from '../shared/approval-patch.js'

export type { FileChangeRecord } from '../shared/approval-patch.js'
export { relativeToFolder, unifiedPatchText } from '../shared/approval-patch.js'

/**
 * The diff behind a file-change approval.
 *
 * Codex's app-server asks `item/fileChange/requestApproval` with only an
 * item id (schema: FileChangeRequestApprovalParams -- itemId, reason,
 * grantRoot). The change itself arrived first, on the fileChange ITEM
 * (`item/started`, and `item/fileChange/patchUpdated` when it grows). So
 * the host remembers each fileChange item's changes as they arrive and,
 * when the approval comes, hands the card the patch for that item -- the
 * approval card's fourth question ("what, exactly?") answered with the
 * change, not a summary of it. The composition itself lives in
 * `shared/approval-patch.ts`, where the renderer's tests can parse it back.
 *
 * Bounded the way the ledger bounds a patch (`toolPatchFrom`): 64 KB of
 * text, counts taken before the cut, `truncated` said.
 */

const MAX_CHANGES_PER_ITEM = 200

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** The changes on a fileChange item, or undefined when the item is not one. */
export function fileChangesOf(item: unknown): readonly FileChangeRecord[] | undefined {
  if (typeof item !== 'object' || item === null) return undefined
  const record = item as Record<string, unknown>
  if (record.type !== 'fileChange' || !Array.isArray(record.changes)) return undefined
  const out: FileChangeRecord[] = []
  for (const entry of record.changes) {
    if (typeof entry !== 'object' || entry === null) continue
    const change = entry as Record<string, unknown>
    const path = stringOf(change.path)
    if (path === undefined) continue
    const kindRecord = typeof change.kind === 'object' && change.kind !== null ? (change.kind as Record<string, unknown>) : {}
    const type = stringOf(kindRecord.type)
    const kind: FileChangeRecord['kind'] = type === 'add' ? 'add' : type === 'delete' ? 'delete' : 'update'
    out.push({ path, kind, movePath: stringOf(kindRecord.move_path), diff: stringOf(change.diff) ?? '' })
    if (out.length >= MAX_CHANGES_PER_ITEM) break
  }
  return out
}

/** The item id a fileChange notification is about, when it carries an item. */
export function itemOf(params: unknown): { readonly id: string; readonly item: unknown } | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const record = params as Record<string, unknown>
  const item = record.item
  if (typeof item !== 'object' || item === null) return undefined
  const id = stringOf((item as Record<string, unknown>).id)
  return id === undefined ? undefined : { id, item }
}

/** The patch for an approval, or undefined when the item is unknown or had no text. */
export function approvalPatchFrom(changes: readonly FileChangeRecord[] | undefined, workspacePath?: string): ToolPatch | undefined {
  if (changes === undefined || changes.length === 0) return undefined
  return toolPatchFrom(unifiedPatchText(changes, workspacePath))
}
