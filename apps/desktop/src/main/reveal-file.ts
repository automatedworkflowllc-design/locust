/**
 * Showing a person the file their teammate just wrote — without letting the
 * renderer name a place on disk.
 *
 * The gap this closes was found by dogfooding (Colin, 2026-09-07): a teammate
 * wrote a report, said its name, and there was nothing to click. The file was
 * on disk the whole time and the app gave no way to reach it. On the web the
 * answer is a download button; on a desktop app the file is already saved, so
 * the honest equivalent is "show me where".
 *
 * WHY THIS IS NOT A ONE-LINE `shell.showItemInFolder` CALL.
 *
 * `main/index.ts` states the rule this has to live under: the renderer names
 * no destinations. `window.open` reaching `shell.openExternal` was removed for
 * exactly this reason — the packaged build cancels every renderer request and
 * refuses every permission, and then hands a string to the operating system
 * where none of that applies. An IPC that reveals whatever path the renderer
 * asks for is the same hole with a different verb: anything running in the
 * renderer could walk the disk through a file manager, one call at a time.
 *
 * So the renderer's path is a REQUEST, not an instruction. It is honoured only
 * when it resolves inside a folder the host already knows a mission ran in.
 * The host holds those roots; the renderer cannot add one.
 *
 * WHAT IS DELIBERATELY NOT HERE: opening the file.
 *
 * `shell.openPath` launches a file with its default handler, which for `.bat`,
 * `.ps1`, `.exe` or a `.lnk` is not "opening" but "running" — and every file in
 * a workspace was written by a model. A one-click path from "a teammate wrote a
 * file" to "Windows executed it" is not worth the two saved seconds. Revealing
 * is enough: the file manager is then in the person's hands, where the choice
 * to run something is theirs and looks like what it is.
 */

import { isAbsolute, relative, resolve } from 'node:path'

/** Why a reveal was refused, in words the card can show. */
export type RevealRefusal =
  | { readonly ok: false; readonly reason: 'no-path' }
  | { readonly ok: false; readonly reason: 'outside'; readonly path: string }

export type RevealDecision = { readonly ok: true; readonly path: string } | RevealRefusal

/**
 * Whether `child` is inside `parent`, by path arithmetic rather than string
 * prefix.
 *
 * A prefix test says `C:\work\shop-secrets` is inside `C:\work\shop`, which is
 * wrong and is the usual way this check is got wrong. `relative()` answers with
 * the steps between them, so the question becomes: does getting there require
 * going UP, and is it still a relative journey once we arrive.
 *
 * Windows makes the comparison case-insensitive in practice, and `relative`
 * already handles that on a win32 path. What it cannot do is see through a
 * symlink or a junction — a link inside the workspace pointing anywhere at all
 * still resolves to a path under the workspace here. That is accepted: the link
 * would itself have to have been created inside a folder the person already
 * chose to hand to a teammate, and revealing where a link points is a long way
 * from the risk this file exists to stop.
 */
export function contains(parent: string, child: string): boolean {
  const from = resolve(parent)
  const to = resolve(child)
  if (from === to) return true
  const step = relative(from, to)
  return step.length > 0 && !step.startsWith('..') && !isAbsolute(step)
}

/**
 * Whether a file is inside one of `roots` ON DISK, links followed (0.543).
 *
 * `contains` is path arithmetic, which is right for SHOWING a file in the
 * file manager. Reading one is different: a link inside the folder could
 * point anywhere, and its contents would be drawn on screen as though they
 * were the folder's (the 0.536 code review, SEC-01). So a READ asks again of
 * the real paths -- the file's and each root's, so a project that is itself
 * reached through a junction still holds its own files.
 */
export async function insideOnDisk(path: string, roots: readonly string[]): Promise<boolean> {
  const { realpath } = await import('node:fs/promises')
  const real = await realpath(path).catch(() => undefined)
  // Not there at all: no link to follow, and the read says it is missing
  // (drive-a-word-file-reads caught a never-written file called a link).
  if (real === undefined) return true
  for (const root of roots) {
    const realRoot = await realpath(root).catch(() => undefined)
    if (realRoot !== undefined && contains(realRoot, real)) return true
  }
  return false
}

/**
 * Decide whether a reveal request may be honoured.
 *
 * `roots` are the workspace folders the HOST knows about — never a list the
 * renderer supplied. An empty list refuses everything, which is the correct
 * answer before any mission has run.
 */
export function decideReveal(requested: unknown, roots: readonly string[]): RevealDecision {
  if (typeof requested !== 'string' || requested.trim().length === 0) {
    return { ok: false, reason: 'no-path' }
  }
  // A relative path is meaningless without knowing which root it is relative
  // to, and guessing would mean trying each root until one exists -- which is a
  // way to probe the disk. The renderer holds absolute paths already.
  if (!isAbsolute(requested)) return { ok: false, reason: 'outside', path: requested }
  const resolved = resolve(requested)
  return roots.some((root) => contains(root, resolved))
    ? { ok: true, path: resolved }
    : { ok: false, reason: 'outside', path: resolved }
}
