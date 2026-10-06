/**
 * ONE BEAT FOR EVERY DRAWING IN THE WINDOW (0.654).
 *
 * Each face and orb is drawn at most 30 times a second (BOT_FRAMES_PER_SECOND,
 * ORB_FRAMES_PER_SECOND), every other frame of a 60 Hz screen. But each kept
 * its own count of which frames those were, from when it started: the cover's
 * bots on the even frames, a teammate's face started later on the odd ones.
 * Measured on packaged 0.653, Home with a teammate working: 46 of every 58
 * frames carried a drawing, so the window was put together and handed to the
 * GPU nearly 60 times a second, for faces each moving at 30.
 *
 * Here every clock asks the same beat whether this frame is a drawing frame.
 * Every animation frame's callbacks are handed the same time, so the first
 * clock to ask in a frame decides it for all the others: they draw together,
 * 30 frames a second in all, each face exactly as often as before.
 */
export interface FrameBeat {
  /** Whether the frame at `now` (an animation frame's time) is one to draw in. */
  readonly due: (now: number) => boolean
}

export function frameBeat(perSecond: number): FrameBeat {
  // A millisecond of slack, so a 60 Hz screen's second frame (33.3 ms) is not
  // turned away for arriving a hair early.
  const every = 1000 / perSecond - 1
  let at = Number.NEGATIVE_INFINITY
  return {
    due: (now) => {
      if (now === at) return true
      // A clock that went backwards (a test's own) starts the beat again.
      if (now - at >= every || now < at) {
        at = now
        return true
      }
      return false
    }
  }
}

/** The window's own beat: 30 drawing frames a second, shared by every face and orb. */
export const DRAWING_BEAT = frameBeat(30)

/**
 * HALF THE BEAT, FOR A FACE AT THE SIDE (0.670). Measured on packaged 0.669,
 * a conversation streaming: 10.5-10.8 % of the machine, 6.0 % with its four
 * faces' canvases hidden -- the face beside the live line, the header's, the
 * sidebar's and the orb, each redrawn 30 times a second. The face you are
 * talking to keeps 30; a face beside a name ('subtle': the sidebar, the
 * header, a card) moves at 15, which at its size reads the same.
 */
export const SIDE_DRAWING_BEAT = frameBeat(15)
