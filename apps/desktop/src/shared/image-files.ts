/**
 * Which attached files are images, and what to call them.
 *
 * Locust shows an attached image as an image -- in the composer before it is
 * sent and in the thread afterwards -- which needs two facts the renderer
 * cannot get on its own: whether a path is an image at all, and the media type
 * to build a `data:` URL with.
 *
 * By EXTENSION, not by sniffing the bytes. The host reads the file anyway and
 * could check its magic number, but the question here is "should this be drawn
 * as a picture", and a file called `notes.txt` that happens to begin with PNG
 * bytes should be drawn as neither. Extension is also what every runtime uses
 * to make the same decision, so this agrees with them by construction.
 *
 * The list is deliberately short. Every entry is a format Chromium renders in
 * an `<img>` without help, because a thumbnail that silently fails to paint is
 * worse than a file row that never claimed to be a picture.
 */

const IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  // SVG is deliberately absent. It is a document that can carry script and
  // fetch remote content, and this renderer would be drawing one chosen from
  // anywhere on the machine. It still attaches and still reaches the runtime
  // as a file; it just is not painted here.
  ['.ico', 'image/x-icon']
])

/**
 * The media type for a path, or undefined when it is not an image we draw.
 *
 * Case-insensitive, because `SHOT.PNG` off a camera or a Windows share is the
 * same file as `shot.png`.
 */
export function imageMediaType(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return IMAGE_TYPES.get(path.slice(dot).toLowerCase())
}

/** Whether a path should be drawn as a picture rather than named as a file. */
export function isImagePath(path: string): boolean {
  return imageMediaType(path) !== undefined
}

/**
 * The largest image the host will hand the renderer, in bytes.
 *
 * A `data:` URL costs about a third more than the file it encodes and lives in
 * the renderer's memory for as long as the thread is open, so a thread with
 * several large screenshots in it is the case this bounds. 8 MB is far above
 * any screenshot and far below a size that would hurt; a file past it still
 * attaches and still reaches the runtime, it is simply named rather than
 * drawn.
 */
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
