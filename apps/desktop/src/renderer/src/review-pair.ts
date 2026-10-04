/**
 * Two reviewers on DIFFERENT coding agents (A3.1, ECC's "santa loop").
 *
 * Locust's edge is that the team is not one model: the same change read by
 * a Claude teammate and a Codex one is two independent readings, where two
 * teammates on one runtime tend to agree for the same reasons. So the pair
 * is chosen for difference -- from each other always, and from the author's
 * agent when the team allows it. No pair where the team cannot give one:
 * two reviewers on the same agent is not what this offers.
 */
export interface ReviewCandidate {
  readonly teammateId: string
  readonly name: string
  readonly runtime: string
}

export function reviewPairOf<T extends ReviewCandidate>(
  reviewers: readonly T[],
  authorRuntime: string | undefined
): readonly [T, T] | undefined {
  const pairs: (readonly [T, T])[] = []
  for (let first = 0; first < reviewers.length; first += 1) {
    for (let second = first + 1; second < reviewers.length; second += 1) {
      const a = reviewers[first]!
      const b = reviewers[second]!
      if (a.runtime !== b.runtime) pairs.push([a, b])
    }
  }
  // Fewest reviewers on the author's own agent first; the team's order breaks ties.
  const onAuthors = (pair: readonly [T, T]): number =>
    pair.filter((one) => authorRuntime !== undefined && one.runtime === authorRuntime).length
  return [...pairs].sort((x, y) => onAuthors(x) - onAuthors(y))[0]
}
