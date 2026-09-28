import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * A WEB PAGE A TEAMMATE MADE, SHOWN WORKING, INSIDE LOCUST (0.425).
 *
 * Colin, 2026-09-28, deciding fresh-eyes finding f045: "we don't want users to
 * have to leave our app to see their html only to ask themselves why they
 * even used us in the first place. Full functionality, sacrifice nothing."
 * (docs/DECISION-2026-09-28-PAGE-PREVIEW.md.)
 *
 * So a page is served to a frame in the viewer at its own address,
 * `locust-page://<token>/<path in the folder>`, from its own folder -- its
 * CSS, scripts and images load as they would from a web server -- and it runs
 * there. What keeps that safe is where it runs, not what it may do:
 *   - its own ORIGIN, never the app's, so it cannot reach the window it sits
 *     in, and the host answers IPC from the top frame only (fromOwnWindow);
 *   - no preload in a sub-frame, so no `window.desktop`;
 *   - files served from inside the folder it came from, checked on the REAL
 *     path, so a link or junction inside the folder cannot serve one outside;
 *   - the session still refuses every device permission.
 * A token is random per root and per launch: the address says nothing about
 * the disk, and one from last week opens nothing.
 */
export const PAGE_SCHEME = 'locust-page'
export const PAGE_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'htm'])

/** The largest file the preview serves. A page's video can be large; nothing here should be 200MB. */
export const MAX_PAGE_FILE_BYTES = 64 * 1024 * 1024

const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', xml: 'application/xml', wasm: 'application/wasm', pdf: 'application/pdf'
}

export function isPagePath(path: string): boolean {
  return PAGE_EXTENSIONS.has(extname(path).slice(1).toLowerCase())
}

/** Whether `inner` is `outer` or inside it, on a platform where case may not matter. */
function within(inner: string, outer: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string): string => {
    const full = resolve(value).replace(/[\\/]+$/, '')
    return platform === 'win32' ? full.toLowerCase() : full
  }
  const a = fold(inner)
  const b = fold(outer)
  return a === b || a.startsWith(b + sep)
}

export interface PageServer {
  /** The address for a page inside one of the roots, or why it has none. */
  urlFor(path: string): Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }>
  /** Answer one request made to the scheme. */
  handle(requestUrl: string): Promise<Response>
}

export function createPageServer(options: {
  /** The folders a page may be served from, read at every request. */
  readonly roots: () => Promise<readonly string[]>
  /**
   * The folder a RELATIVE path is read from (0.446): the one teammates work
   * in. A runtime may name the page it wrote relative to that folder --
   * OpenCode does, and a comparison column's page sits in its copy under
   * `.locust/compare/` -- and the main process's own working folder is
   * wherever Locust was launched from, so such a page read as "not there".
   */
  readonly base?: () => string | undefined
  readonly platform?: NodeJS.Platform
}): PageServer {
  const platform = options.platform ?? process.platform
  const tokens = new Map<string, string>()
  const tokenFor = (root: string): string => {
    for (const [token, held] of tokens) if (within(held, root, platform) && within(root, held, platform)) return token
    const token = randomBytes(12).toString('hex')
    tokens.set(token, root)
    return token
  }
  const realRoots = async (): Promise<readonly string[]> =>
    (await Promise.all((await options.roots()).map((root) => realpath(root).catch(() => undefined)))).filter((root): root is string => root !== undefined)
  return {
    async urlFor(path) {
      if (!isPagePath(path)) return { ok: false, message: 'Only a web page (.html) opens as a page.' }
      const from = options.base?.()
      const full = isAbsolute(path) || from === undefined ? resolve(path) : resolve(from, path)
      // A comparison column's copy is removed once one is kept, and the kept
      // one's page is then in the folder itself, at the same place (0.446) --
      // whether the copy was a worktree in the folder or, in a folder that is
      // not a git project, a plain copy under ~/.locust/compare (0.448).
      const kept = from === undefined ? undefined : /[\\/]\.locust[\\/]compare[\\/]cmp_[A-Za-z0-9]+-[abc][\\/](.+)$/.exec(full)
      const real = await realpath(full).catch(async () =>
        kept?.[1] !== undefined && from !== undefined ? realpath(join(from, kept[1])).catch(() => undefined) : undefined
      )
      if (real === undefined) return { ok: false, message: 'That page is not there. The teammate named it but did not write it.' }
      const root = (await realRoots()).find((candidate) => within(real, candidate, platform))
      if (root === undefined) return { ok: false, message: 'That page is outside the folder your teammates work in, so Locust will not open it.' }
      const inside = relative(root, real).split(sep).map(encodeURIComponent).join('/')
      return { ok: true, url: `${PAGE_SCHEME}://${tokenFor(root)}/${inside}` }
    },
    async handle(requestUrl) {
      const refuse = (status: number, text: string): Response => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      let url: URL
      try {
        url = new URL(requestUrl)
      } catch {
        return refuse(400, 'Not an address.')
      }
      const root = tokens.get(url.hostname)
      if (root === undefined) return refuse(404, 'Nothing is served here.')
      let inside: string
      try {
        inside = decodeURIComponent(url.pathname)
      } catch {
        return refuse(400, 'Not an address.')
      }
      const wanted = resolve(join(root, inside))
      if (!within(wanted, root, platform)) return refuse(403, 'Outside the page\'s folder.')
      let real = await realpath(wanted).catch(() => undefined)
      if (real === undefined || !within(real, root, platform)) return refuse(404, 'Not found.')
      let measured = await stat(real).catch(() => undefined)
      if (measured?.isDirectory() === true) {
        real = await realpath(join(real, 'index.html')).catch(() => undefined)
        if (real === undefined || !within(real, root, platform)) return refuse(404, 'Not found.')
        measured = await stat(real).catch(() => undefined)
      }
      if (measured === undefined || !measured.isFile()) return refuse(404, 'Not found.')
      if (measured.size > MAX_PAGE_FILE_BYTES) return refuse(413, 'Too large to serve here.')
      const body = await readFile(real)
      const type = TYPES[extname(real).slice(1).toLowerCase()] ?? 'application/octet-stream'
      return new Response(body, { status: 200, headers: { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' } })
    }
  }
}

/**
 * Whether a request comes from a page shown in the preview, or from inside
 * one -- a frame the page itself embedded (0.425). Packaged Locust refuses
 * every web request its own window makes; a page is allowed its own, as it
 * would have in a browser. The app's top frame is never a page.
 */
export function fromPagePreview(frame: { readonly url: string; readonly parent: unknown } | null | undefined): boolean {
  let current = frame as { readonly url: string; readonly parent: unknown } | null | undefined
  for (let depth = 0; current !== null && current !== undefined && depth < 16; depth += 1) {
    if (current.url.startsWith(`${PAGE_SCHEME}://`)) return true
    current = current.parent as { readonly url: string; readonly parent: unknown } | null
  }
  return false
}
