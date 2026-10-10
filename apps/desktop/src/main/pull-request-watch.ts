import { pullRequestNews, type FolderPullRequest, type PullRequestNews } from '../shared/pull-request.js'

/**
 * Watching the folder's pull request (0.731, shared/pull-request.ts `pullRequestNews`): while the person has asked,
 * it is looked at every few minutes, and what changed is said. One timer while anything is watched, none otherwise;
 * a merged or closed one is no longer watched once that has been said.
 */
export interface PullRequestWatchOptions {
  /** The folder's pull request as it is now, or undefined. */
  readonly read: () => Promise<FolderPullRequest | undefined>
  readonly onNews: (news: PullRequestNews) => void
  readonly everyMs?: number
  readonly schedule?: (task: () => void, ms: number) => unknown
  readonly clear?: (handle: unknown) => void
}

/** Every three minutes: often enough to hear of a failed check before the next look, rarely enough to be no load. */
export const PULL_REQUEST_WATCH_MS = 3 * 60_000

export function createPullRequestWatch(options: PullRequestWatchOptions) {
  const everyMs = options.everyMs ?? PULL_REQUEST_WATCH_MS
  const schedule = options.schedule ?? ((task, ms) => setInterval(task, ms))
  const clear = options.clear ?? ((handle) => clearInterval(handle as NodeJS.Timeout))
  const watched = new Set<string>()
  const last = new Map<string, FolderPullRequest>()
  let timer: unknown
  let looking = false

  const look = async (): Promise<void> => {
    if (looking || watched.size === 0) return
    looking = true
    try {
      const now = await options.read().catch(() => undefined)
      if (now === undefined || !watched.has(now.url)) return
      const before = last.get(now.url)
      last.set(now.url, now)
      const news = before === undefined ? undefined : pullRequestNews(before, now)
      if (news !== undefined) options.onNews(news)
      if (now.state === 'merged' || now.state === 'closed') watch(now.url, false)
    } finally {
      looking = false
    }
  }

  const watch = (url: string, on: boolean): void => {
    if (on) watched.add(url)
    else {
      watched.delete(url)
      last.delete(url)
    }
    if (watched.size > 0 && timer === undefined) timer = schedule(() => void look(), everyMs)
    if (watched.size === 0 && timer !== undefined) {
      clear(timer)
      timer = undefined
    }
    // The first look is the one later ones are compared with.
    if (on) void look()
  }

  return {
    watch,
    watching: (url: string): boolean => watched.has(url),
    stop: (): void => {
      watched.clear()
      last.clear()
      if (timer !== undefined) clear(timer)
      timer = undefined
    },
    /** Test seam: one look now. */
    look
  }
}
