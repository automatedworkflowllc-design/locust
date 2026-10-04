import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * THE ATTENTION MARK (0.590): when the person was last at the window.
 *
 * Written when the window loses focus, when it closes, when Locust quits and
 * once a minute while it has focus (so a crash leaves a recent mark). Read
 * at the next start: if that moment is at least AWAY_MINIMUM_MS ago, the
 * window shows "Since you were away" from it (shared/away.ts). The file is
 * the whole preference: missing or unreadable means nobody was here before.
 */

export const AWAY_FILE = 'away.json'

export function attentionMarkFrom(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const at = (value as { readonly at?: unknown }).at
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return undefined
  return at
}

export function readAttentionMark(file: string): string | undefined {
  try {
    return attentionMarkFrom(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return undefined
  }
}

/** Whole or absent: written beside, then renamed over, as the other stores do. */
export function writeAttentionMark(file: string, at: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ at })}\n`, 'utf8')
  renameSync(temporary, file)
}
