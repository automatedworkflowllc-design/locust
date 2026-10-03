import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

import type { PetRef } from '../../../shared/avatar.js'
import type { PetState } from '../../../shared/pets.js'
import { anchorsOf, anchorVariables } from '../botAnchors.js'
import type { GlanceSide } from '../glances.js'
import { petCellAt, petGlanceCell, petNextChangeIn } from '../petMotion.js'
import { usePetLook } from '../pets.js'
import type { PetAtlas } from '../pets.js'
import { GLANCE_HOLD_MS } from './Bot.js'

/**
 * A PET, DRAWN IN A TEAMMATE'S FACE'S BOX (0.563).
 *
 * One frame of the pet's sheet at a time, fitted to the box by its height
 * (frames are 192 x 208, and a pet's makers fill them) and centred, so a pet
 * stands where a bot stands. Nothing is added to the art: no plastic, no
 * outline, no tint -- a pet is drawn art and keeps its own look, and the
 * teammate's colour stays in its name and its marks. Bots and pets side by
 * side read as two kinds of teammate, which they are.
 *
 * ITS CLOCK WAKES ONLY WHEN THE FRAME CHANGES. A bot is drawn up to 30 times
 * a second because it moves continuously; a pet's rows step a few times a
 * second (OpenPets' timings: 6 frames in 820 ms at work), and its resting
 * pose not at all, so this sleeps until the next frame is due and draws only
 * when it changes. Like a bot, it holds still out of sight, in a window in
 * the background, and for reduced motion.
 *
 * Drawn on a canvas rather than moved as a CSS sprite so its frame is cut
 * exactly -- a stepped background or transform lands frames on fractions of
 * a pixel at these sizes and shows a sliver of the next one -- and so its
 * paint can be measured for the waiting ring and the presence dot, which sit
 * on its body as they sit on a bot's (botAnchors.ts).
 */
export interface PetSpriteProps {
  readonly pet: PetRef
  readonly size: number
  readonly state: PetState
  /** Holds its pose; a pet at rest always does. */
  readonly still?: boolean
  /** Looks this way for a moment (glances.ts): a version 2 head turns. */
  readonly glance?: GlanceSide
}

/** Puts the ring and the dot on the pet's body: its resting pose's paint, placed in the box. */
function anchorToPet(canvas: HTMLCanvasElement, atlas: PetAtlas, left: number, width: number): void {
  const host = canvas.closest<HTMLElement>('.lc-bot')
  if (host === null) return
  const body = atlas.body
  // The frame fills the box's height, so a fraction of the frame's height is one of the box's.
  const anchors = anchorsOf({
    left: left + body.left * width,
    top: body.top,
    right: left + body.right * width,
    bottom: body.bottom
  })
  for (const [name, value] of Object.entries(anchorVariables(anchors))) host.style.setProperty(name, value)
}

export function PetSprite({ pet, size, state, still = false, glance }: PetSpriteProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const look = usePetLook(pet)
  // When the state began, kept across a glance so a jump is not restarted by one.
  const began = useRef<{ state: PetState; at: number } | undefined>(undefined)
  const glanced = useRef<{ side: GlanceSide; at: number } | undefined>(undefined)

  useEffect(() => {
    glanced.current = glance === undefined ? undefined : { side: glance, at: performance.now() }
  }, [glance])

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null || look?.status !== 'ready') return undefined
    const context = canvas.getContext('2d')
    if (context === null) return undefined
    const atlas = look.atlas
    if (began.current?.state !== state) began.current = { state, at: performance.now() }
    const startedAt = began.current.at
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const side = Math.max(1, Math.round(size * dpr))
    canvas.width = side
    canvas.height = side
    const drawWidth = (side * atlas.frameWidth) / atlas.frameHeight
    const left = (side - drawWidth) / 2
    anchorToPet(canvas, atlas, left / side, drawWidth / side)
    const frozen = still || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    let drawn = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let onScreen = true

    const glancing = (now: number): GlanceSide | undefined => {
      const looking = glanced.current
      return looking !== undefined && now - looking.at < GLANCE_HOLD_MS ? looking.side : undefined
    }

    const draw = (now: number): void => {
      const cell = petCellAt(state, now - startedAt, atlas.rows, frozen)
      const toward = glancing(now)
      const turned = toward === undefined ? undefined : petGlanceCell(toward, atlas.rows)
      const shown = turned ?? cell
      canvas.dataset.petState = cell.shown
      const key = `${String(shown.row)}:${String(shown.column)}`
      if (key === drawn) return
      drawn = key
      context.clearRect(0, 0, side, side)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(
        atlas.image,
        shown.column * atlas.frameWidth,
        shown.row * atlas.frameHeight,
        atlas.frameWidth,
        atlas.frameHeight,
        left,
        0,
        drawWidth,
        side
      )
    }

    const tick = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      const now = performance.now()
      draw(now)
      if (!onScreen || document.visibilityState === 'hidden') return
      const looking = glanced.current
      const glanceLeft = looking !== undefined && now - looking.at < GLANCE_HOLD_MS ? GLANCE_HOLD_MS - (now - looking.at) : undefined
      const next = petNextChangeIn(state, now - startedAt, frozen)
      const wait = next === undefined ? glanceLeft : glanceLeft === undefined ? next : Math.min(next, glanceLeft)
      if (wait !== undefined) timer = setTimeout(tick, Math.max(16, wait))
    }

    tick()
    const watch =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            const was = onScreen
            onScreen = entry?.isIntersecting ?? true
            if (onScreen && !was) tick()
          })
    watch?.observe(canvas)
    const wake = (): void => {
      if (document.visibilityState !== 'hidden') tick()
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      watch?.disconnect()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [look, size, state, still, glance])

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-face="pet"
      data-pet={pet.id}
      data-pet-state={state}
      style={{ display: 'block', flex: 'none', width: size, height: size }}
    />
  )
}
