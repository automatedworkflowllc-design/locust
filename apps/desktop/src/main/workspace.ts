import { createHash } from 'node:crypto'

/**
 * The id a mission records for the folder it ran in.
 *
 * Derived from the path, so the same folder always produces the same id and a
 * mission can be matched back to where it happened. Codex missions were
 * already doing this inline; the app-server and Antigravity paths were minting
 * a RANDOM id instead, which looks the same in a receipt and means the
 * opposite -- their missions could never be matched to any folder at all.
 * MEASURED 2026-09-03 while making the app open the right conversation for the
 * folder it was launched in.
 *
 * Hashed rather than stored plainly: the ledger is a durable local record and
 * a path can name a person, a client, or an unreleased project.
 */
export function workspaceIdFor(workspacePath: string): string {
  return `ws_${createHash('sha256').update(workspacePath, 'utf8').digest('hex').slice(0, 32)}`
}
