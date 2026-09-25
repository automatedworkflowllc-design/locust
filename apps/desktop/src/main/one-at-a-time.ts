/**
 * Calls of `work` run one after another, never overlapping, in the order
 * they were made. A failed call does not stop the ones behind it.
 *
 * For writers that read the tail of a record and append after it: two of
 * them at once read the same tail and the second is refused. The relay's
 * `note` was one -- it fires several notes without waiting, so the second
 * ending note for a mission was lost (the code review's B4 leads).
 */
export function oneAtATime<Args extends unknown[]>(work: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (...args: Args) => {
    const next = tail.then(() => work(...args))
    tail = next.catch(() => undefined)
    return next
  }
}
