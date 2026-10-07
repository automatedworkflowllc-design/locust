/**
 * Commit, push, pull request (0.680): what the window and the host share --
 * main/folder-commit.ts does the git, components/CommitChanges.tsx asks for it.
 */

export const FOLDER_CHANGES_CHANNEL = 'folder:changes'
export const FOLDER_COMMIT_CHANNEL = 'folder:commit'

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FolderRemote {
  /** Always `origin`: the remote a push and a pull request go to. */
  readonly name: string
  /** The branch already tracks one there, so a plain push knows where to go. */
  readonly upstream: boolean
  /** The remote's default branch, the base of a pull request: `main`. */
  readonly defaultBranch: string
  /** On GitHub, and the person's `gh` is signed in: a pull request can be opened. */
  readonly pullRequests: boolean
}

export type FolderChanges =
  | { readonly kind: 'none'; readonly why: 'not-a-repository' | 'clean' }
  /** Changes git would not let a plain commit take as they are. */
  | { readonly kind: 'blocked'; readonly why: BlockedWhy; readonly files: readonly string[] }
  | {
      readonly kind: 'changes'
      readonly branch: string
      readonly files: readonly { readonly path: string; readonly status: ChangeStatus }[]
      readonly remote?: FolderRemote
    }

export type CommitThen = 'commit' | 'push' | 'pull-request'

export type CommitResult =
  | {
      readonly kind: 'done'
      readonly sha: string
      readonly branch: string
      readonly files: number
      /** Untracked files too big to commit, left as they are. */
      readonly leftOut: readonly string[]
      /** A branch made for the pull request, the checkout now on it. */
      readonly newBranch?: string
      readonly pushed?: boolean
      readonly pullRequestUrl?: string
      /** The commit was made; what came after it was not. */
      readonly after?: string
    }
  | { readonly kind: 'refused'; readonly message: string }

/**
 * The message a commit starts with: the person's first ask in the
 * conversation as the subject, any later asks as the body, and who did the
 * work -- the same shape Land's draft has (landingDraft). Edited freely.
 */
export function commitDraft(input: { readonly asks: readonly string[]; readonly teammate?: string }): string {
  const lines = input.asks
    .map((ask) => ask.replace(/\s+/g, ' ').trim())
    .filter((ask) => ask.length > 0)
  const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)
  // The first sentence when it fits a subject line, rather than the ask cut off mid-sentence.
  const first = lines[0]
  const sentence = first === undefined ? undefined : /^.+?[.!?]['"’”)]?(?=\s|$)/.exec(first)?.[0]
  const subject = clip(sentence !== undefined && sentence.length <= 72 ? sentence : first ?? (input.teammate === undefined ? 'Changes' : `${input.teammate}'s changes`), 72)
  const body = lines.length > 1 ? `\n\n${lines.map((line) => `- ${clip(line, 100)}`).join('\n')}` : ''
  const trailer = input.teammate === undefined ? '' : `\n\nLocust-Teammate: ${input.teammate}`
  return `${subject}${body}${trailer}`
}

/** Why a plain commit cannot be made here. `branch-name`: a name Locust will not hand to git (Sol's review, 0.683). */
export type BlockedWhy = 'merging' | 'rebasing' | 'detached' | 'conflicted' | 'branch-name'

export function blockedSentence(why: BlockedWhy): string {
  switch (why) {
    case 'merging': return 'A merge is in progress in this folder. Finish or abort it in git first.'
    case 'rebasing': return 'A rebase is in progress in this folder. Finish or abort it in git first.'
    case 'detached': return 'This folder is not on a branch, so a commit would belong to none. Switch to a branch first.'
    case 'conflicted': return 'Some files still have unresolved conflicts. Resolve them first.'
    case 'branch-name': return "This branch's name is not one Locust will pass to git (it starts with a dash, or has unusual characters). Rename the branch first."
  }
}

