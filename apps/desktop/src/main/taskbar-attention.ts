/**
 * THE TASKBAR SAYS WHEN SOMETHING NEEDS YOU (0.379).
 *
 * Inside the window, the title bar's amber "N need you" chip says it. Behind
 * another app, nothing did -- a teammate could wait on an approval for an
 * hour. Orca badges its macOS Dock icon (dock/unread-badge.ts, read
 * 2026-09-26) and has nothing on Windows; the taskbar is where a Windows
 * person looks. So, while anything needs the person:
 *
 * - an amber dot sits on the Locust taskbar button (an overlay icon, which
 *   Windows also reads aloud: "2 things need you"), gone when nothing does;
 * - the button flashes when the count RISES while the window is elsewhere --
 *   not every time the count is sent, and never while the person is looking.
 *
 * Passive, unlike a toast: it cannot train anyone to dismiss the one that
 * matters (attention.ts). The decision is pure; the dot is drawn here, as
 * raw pixels, so there is no asset to ship or lose.
 */

export interface TaskbarAttention {
  readonly overlay: 'dot' | 'none'
  readonly flash: boolean
  /** What Windows says for the overlay. */
  readonly description: string
}

export function taskbarAttention(previous: number, count: number, focused: boolean): TaskbarAttention {
  return {
    overlay: count > 0 ? 'dot' : 'none',
    flash: count > previous && !focused,
    description: count === 1 ? '1 thing needs you' : `${String(count)} things need you`
  }
}

/** A count from the renderer, or nothing: only a small whole number is believed. */
export function needsYouCountFrom(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 999 ? raw : undefined
}

/** The needs-you amber (tokens.css `--lc-amber`, #e9b949). */
const AMBER: readonly [number, number, number] = [0xe9, 0xb9, 0x49]
/** A dark ring, so the dot reads on a light taskbar as well as a dark one. */
const RING: readonly [number, number, number] = [0x1c, 0x1d, 0x1f]

/**
 * The dot: an amber disc in a thin dark ring, anti-aliased, as premultiplied
 * BGRA -- what `nativeImage.createFromBitmap` takes on Windows.
 */
export function attentionDot(size = 16): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  const centre = (size - 1) / 2
  const outer = size / 2 - 0.5
  const inner = outer - 1.5
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre)
      // Coverage of each edge, a pixel wide, for a smooth rim.
      const disc = Math.max(0, Math.min(1, outer - distance + 0.5))
      const fill = Math.max(0, Math.min(1, inner - distance + 0.5))
      const colour = AMBER.map((channel, index) => channel * fill + RING[index]! * (1 - fill))
      const at = (y * size + x) * 4
      // Premultiplied: each channel carries the pixel's coverage.
      pixels[at] = Math.round(colour[2]! * disc)
      pixels[at + 1] = Math.round(colour[1]! * disc)
      pixels[at + 2] = Math.round(colour[0]! * disc)
      pixels[at + 3] = Math.round(255 * disc)
    }
  }
  return pixels
}
