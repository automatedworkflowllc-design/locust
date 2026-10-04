/** `locust/<name>`: the teammate's branch, the name lower-cased and folded to what git accepts. */
export const BRANCH_PREFIX = 'locust/'

const fold = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/\.lock$/, '')
    .slice(0, 40)

/**
 * The branch a teammate's own worktree is on. A name that folds to nothing
 * -- any non-Latin or emoji name -- is named by the teammate's id instead:
 * it used to be `locust/teammate` for all of them, and git refuses a second
 * tree on a branch already checked out (M17, the code review).
 */
export function branchNameFor(name: string, teammateId?: string): string {
  const slug = fold(name)
  if (slug.length > 0) return `${BRANCH_PREFIX}${slug}`
  const own = teammateId === undefined ? '' : fold(teammateId)
  return `${BRANCH_PREFIX}${own.length > 0 ? own : 'teammate'}`
}

/**
 * The same branch with the teammate's id on the end, for when another
 * worktree already has `branchNameFor` checked out: "Dev 1" and "Dev-1", or
 * "Wren" and a later "wren", fold to one name (M17).
 */
export function distinctBranchNameFor(name: string, teammateId: string): string {
  const id = fold(teammateId.replace(/^tm_/, ''))
  return `${branchNameFor(name, teammateId)}-${id.length > 0 ? id : 'teammate'}`
}
