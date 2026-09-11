/**
 * The conditions a run happened under: scope, stated positively.
 *
 * The design agent's ruling, 2026-09-11, answering whether the app should say
 * what a run could NOT have checked. It should not, and the reasoning is
 * worth keeping where the code is:
 *
 *   The negative list -- "did not test macOS", "nobody opened a browser" --
 *   needs the app to decide WHICH absences matter, and that is a judgement
 *   about what the diff means. It is the same inference the commands line
 *   already refuses ("nothing decides that `pnpm test` is a test"), only
 *   harder. Take the inference away and the list is true of every run, so it
 *   prints on every run, and a qualifier that never varies is furniture.
 *
 *   "State scope, not absence. Scope is bounded, derivable and register-free.
 *   Absence is infinite and requires you to choose which absences matter,
 *   which is the reader's job and the one thing the app cannot do."
 *
 * There is exactly one fact here that needs no inference and is knowable with
 * certainty: a Locust run happens on ONE MACHINE, in ONE ENVIRONMENT. That is
 * architecture, not a guess. `Ran on Windows` tells a person who changed a
 * path handler everything a macOS warning would have, and tells a person who
 * changed a copy string nothing -- correctly, because for them there is
 * nothing to say.
 *
 * It lives on the receipt because the receipt is already the place that
 * answers "under what conditions is this record true", and is already
 * collapsed by default: a reader opens it when they are deciding whether to
 * trust the run, which is exactly the moment this matters.
 */

/** `win32` -> `Windows`. The platform as a person would name it. */
export function platformName(platform: string): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  // Unknown: the raw value, which is still true, rather than a guess or a
  // blank. Every other branch here is a rename, not an inference.
  return platform.trim().length === 0 ? 'this machine' : platform
}

/**
 * The receipt's `Ran on` line.
 *
 * The folder is named only when the mission's own workspace is the one open
 * now. A recovered mission records the workspace it RAN in as an id, not a
 * path, so printing today's folder beside an older run would be a claim
 * nothing supports -- and this whole line exists to be the part of the
 * receipt that cannot be wrong.
 */
export function ranOnLine(input: {
  readonly platform: string
  /** The folder now open, when this mission is one of its own. */
  readonly folder?: string
}): string {
  const where = platformName(input.platform)
  const folder = input.folder?.trim()
  return folder === undefined || folder.length === 0 ? where : `${where} · ${folder}`
}

/** The last segment of a path, as a folder is spoken about. */
export function folderName(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]+/)
  const last = parts.at(-1)
  return last === undefined || last.length === 0 ? undefined : last
}
