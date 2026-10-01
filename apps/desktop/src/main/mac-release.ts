/**
 * A NEWER LOCUST FOR THIS MAC, SAID (0.515).
 *
 * macOS lets an app replace itself only when it is signed with an Apple
 * Developer ID, and the Mac builds are not signed yet -- so a Mac copy cannot
 * update itself. A tester, 2026-10-01: "oh no updates also, thats kind of
 * rough". Until it is signed, the app at least knows: it reads the newest
 * releases, finds the newest one that has a disk image for this Mac's chip,
 * and when that is newer than itself, offers the download. Installing stays
 * the person's: open the image, drag Locust into Applications.
 *
 * Only a release's own download address on the releases repository is ever
 * offered, so a changed API answer cannot point the person anywhere else.
 */

export const MAC_RELEASES_API = 'https://api.github.com/repos/automatedworkflowllc-design/locust-releases/releases?per_page=10'
const DOWNLOAD_PREFIX = 'https://github.com/automatedworkflowllc-design/locust-releases/releases/download/'

export interface MacRelease {
  readonly version: string
  readonly url: string
  /** The image's size and SHA-256, as the releases API states them: what a download must match (0.516). */
  readonly size?: number
  readonly sha256?: string
}

/** `0.515.0` against `0.514.0`; a pre-release or anything unparsed is never newer. */
function newer(candidate: string, current: string): boolean {
  const parse = (text: string): readonly number[] | undefined => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const a = parse(candidate)
  const b = parse(current.replace(/-.*$/, ''))
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return false
}

/** The newest published release with this chip's disk image, when it is newer than `current`. */
export function newerMacRelease(releases: unknown, current: string, arch: string): MacRelease | undefined {
  if (!Array.isArray(releases)) return undefined
  const suffix = arch === 'arm64' ? '-mac-arm64.dmg' : '-mac-x64.dmg'
  for (const entry of releases) {
    if (typeof entry !== 'object' || entry === null) continue
    const release = entry as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }
    if (release.draft === true || release.prerelease === true || typeof release.tag_name !== 'string') continue
    const assets = Array.isArray(release.assets) ? release.assets : []
    const image = assets
      .map((asset) => (typeof asset === 'object' && asset !== null ? (asset as { name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown }) : {}))
      .find((asset) => typeof asset.name === 'string' && asset.name.endsWith(suffix) && typeof asset.browser_download_url === 'string')
    if (image === undefined) continue
    const url = image.browser_download_url as string
    if (!url.startsWith(DOWNLOAD_PREFIX) || !url.endsWith('.dmg')) continue
    const version = release.tag_name.replace(/^v/, '')
    // Releases come newest first: the first with an image is the one to offer, or none.
    if (!newer(version, current)) return undefined
    const sha256 = typeof image.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(image.digest) ? image.digest.slice('sha256:'.length) : undefined
    return { version, url, ...(typeof image.size === 'number' ? { size: image.size } : {}), ...(sha256 === undefined ? {} : { sha256 }) }
  }
  return undefined
}
