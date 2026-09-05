/** `locust/<name>`: the teammate's branch, the name lower-cased and folded to what git accepts. */
export const BRANCH_PREFIX = 'locust/'

export function branchNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/\.lock$/, '')
    .slice(0, 40)
  return `${BRANCH_PREFIX}${slug.length === 0 ? 'teammate' : slug}`
}
