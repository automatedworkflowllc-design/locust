/**
 * A WebP image's size and whether it has transparency, read from its first
 * bytes (0.563, pet sheets). No image library: Locust ships no native image
 * module, and these few header fields are all a pet sheet is checked by
 * before it is kept. The renderer's own decode is the last word -- a sheet
 * that reads here and still fails to draw shows the teammate's bot.
 *
 * The container (RFC 9649): "RIFF", a little-endian length, "WEBP", then the
 * first chunk, which says which of the three formats follows:
 *   - "VP8 " (lossy): a 3-byte frame tag, the start code 9d 01 2a, then
 *     14-bit width and height. No alpha of its own (that needs VP8X + ALPH).
 *   - "VP8L" (lossless): the signature byte 0x2f, then 14 bits of width - 1,
 *     14 of height - 1, one bit for alpha and three of version (always 0).
 *   - "VP8X" (extended): a flags byte (0x10 alpha, 0x02 animation), three
 *     reserved bytes, then 24 bits each of canvas width - 1 and height - 1.
 */

export interface WebpSize {
  readonly width: number
  readonly height: number
  readonly alpha: boolean
  /** More than one frame: a pet sheet must be one still image. */
  readonly animated: boolean
}

/** How many bytes `webpSize` needs to read. */
export const WEBP_HEADER_BYTES = 30

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length))
}

function little(bytes: Uint8Array, at: number, length: number): number {
  let value = 0
  for (let index = length - 1; index >= 0; index -= 1) value = value * 256 + (bytes[at + index] ?? 0)
  return value
}

/**
 * The size of the WebP image these bytes begin, or undefined when they are
 * not one (or not one this reads). `fileLength`, when known, must agree with
 * the RIFF length -- a sheet cut short in a download fails here, not later.
 */
export function webpSize(bytes: Uint8Array, fileLength?: number): WebpSize | undefined {
  if (bytes.length < WEBP_HEADER_BYTES) return undefined
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined
  const riffLength = little(bytes, 4, 4)
  // The RIFF length counts everything after its own 8 bytes, padded to even.
  if (riffLength < 12) return undefined
  if (fileLength !== undefined && riffLength + 8 !== fileLength && riffLength + 8 !== fileLength - 1) return undefined
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined
    const width = little(bytes, 26, 2) & 0x3fff
    const height = little(bytes, 28, 2) & 0x3fff
    return width === 0 || height === 0 ? undefined : { width, height, alpha: false, animated: false }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return undefined
    const bits = little(bytes, 21, 4)
    // The version is the top three bits and is always 0.
    if (Math.floor(bits / 2 ** 29) !== 0) return undefined
    return {
      width: (bits & 0x3fff) + 1,
      height: (Math.floor(bits / 2 ** 14) & 0x3fff) + 1,
      alpha: (Math.floor(bits / 2 ** 28) & 1) === 1,
      animated: false
    }
  }
  if (chunk === 'VP8X') {
    const flags = bytes[20] ?? 0
    return {
      width: little(bytes, 24, 3) + 1,
      height: little(bytes, 27, 3) + 1,
      alpha: (flags & 0x10) !== 0,
      animated: (flags & 0x02) !== 0
    }
  }
  return undefined
}
