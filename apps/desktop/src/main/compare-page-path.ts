import { isAbsolute, relative, sep } from 'node:path'

/** The page name that can be read in this column's copy, then in the folder after Keep. */
export function comparePagePath(requested: string, copy: string): string | undefined {
  if (!isAbsolute(requested)) return requested
  // A tool may report the absolute path in its copy. Keep removes that copy; the same
  // page now belongs to the folder. Only this exact column's paths may be reinterpreted.
  const inside = relative(copy, requested)
  return inside.length === 0 || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) ? undefined : inside
}
