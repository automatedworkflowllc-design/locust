/**
 * THE FOLDER'S CHANGES, IN ONE PANEL (0.732), as Claude Code's own Changes panel has them (claude.ai/code, seen
 * 2026-10-10): the branch against the base it came from -- `main → <branch>` -- with every file's diff in one
 * scroll, a tree of the files, and the commits, any one of which can be looked at alone. The plan's look-and-feel
 * table: "one panel for every file a folder conversation changed, built from a screenshot of Claude Code's own".
 *
 * Read with the person's own git; nothing is written. Committed and uncommitted changes together, new files too,
 * as the folder is now against where its branch left the base.
 */
export const FOLDER_DIFF_CHANNEL = 'folder:diff'

export interface FolderCommitRow {
  readonly sha: string
  readonly short: string
  readonly subject: string
  readonly author: string
  /** ISO. */
  readonly at: string
}

export type FolderDiff =
  | { readonly kind: 'none'; readonly why: 'not-a-repository' | 'clean' }
  | {
      readonly kind: 'diff'
      /** What it is compared with: the default branch's name, or `HEAD` on the default branch itself. */
      readonly base: string
      readonly branch: string
      /** A unified diff, as git prints one. */
      readonly text: string
      /** Cut at the limit: the rest is not shown. */
      readonly truncated: boolean
      /** The branch's own commits, newest first. */
      readonly commits: readonly FolderCommitRow[]
      /** The whole change, or one commit by its sha. */
      readonly showing: 'all' | string
    }

/** Above this a diff is cut, said so, and the rest left to the person's own tools. */
export const FOLDER_DIFF_MAX_BYTES = 3 * 1024 * 1024
/** New files shown whole, at most this many, each at most this large. */
export const FOLDER_DIFF_MAX_NEW_FILES = 200
export const FOLDER_DIFF_MAX_NEW_FILE_BYTES = 512 * 1024
