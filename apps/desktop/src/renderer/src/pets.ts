import { useEffect, useSyncExternalStore } from 'react'

import type { PetRef } from '../../shared/avatar.js'
import type { PublicPet } from '../../shared/ipc.js'
import { PET_COLUMNS, PET_NEUTRAL } from '../../shared/pets.js'
import type { PetRows } from '../../shared/pets.js'
import { paintedBounds } from './botAnchors.js'

/**
 * THE PETS THE WINDOW HAS READ (0.563): each pet's sheet, decoded once and
 * shared by every face that wears it, and the list of pets on this computer
 * for the look picker. The host checks and reads the files
 * (main/pet-library.ts); here a pet is only ever its source and id.
 */

/** Where a pet's resting pose has paint, as fractions of one frame: what its ring and dot sit on. */
export interface PetBody {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface PetAtlas {
  readonly image: CanvasImageSource
  readonly rows: PetRows
  readonly frameWidth: number
  readonly frameHeight: number
  readonly body: PetBody
}

export type PetLook =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly atlas: PetAtlas }
  /** Gone or unreadable: the teammate shows its bot, and the look picker says why. */
  | { readonly status: 'missing'; readonly reason: string }

const LOADING: PetLook = { status: 'loading' }
const looks = new Map<string, PetLook>()
const listeners = new Set<() => void>()

export function petKey(ref: PetRef): string {
  return `${ref.source}/${ref.id}`
}

function changed(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** What the window knows of this pet now. */
export function petLook(ref: PetRef): PetLook {
  return looks.get(petKey(ref)) ?? LOADING
}

/** Set what a pet is: for the look picker after it adds one, and for tests. */
export function setPetLook(ref: PetRef, look: PetLook | undefined): void {
  if (look === undefined) looks.delete(petKey(ref))
  else looks.set(petKey(ref), look)
  changed()
}

/** The resting pose's painted bounds, read from the sheet's own pixels. */
function bodyOf(image: CanvasImageSource, rows: PetRows, frameWidth: number, frameHeight: number): PetBody {
  const whole: PetBody = { left: 0, top: 0, right: 1, bottom: 1 }
  if (typeof document === 'undefined') return whole
  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return whole
  const column = rows === 11 ? PET_NEUTRAL.column : 0
  context.drawImage(image, column * frameWidth, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight)
  const painted = paintedBounds(context.getImageData(0, 0, frameWidth, frameHeight).data, frameWidth, frameHeight)
  if (painted === undefined) return whole
  return {
    left: painted.left / frameWidth,
    top: painted.top / frameHeight,
    right: painted.right / frameWidth,
    bottom: painted.bottom / frameHeight
  }
}

const reading = new Set<string>()

/** Reads a pet's sheet once; every face wearing it is told when it is ready, or missing. */
export async function ensurePet(ref: PetRef): Promise<void> {
  const key = petKey(ref)
  if (looks.has(key) || reading.has(key)) return
  const bridge = typeof window === 'undefined' ? undefined : window.desktop
  if (bridge === undefined) return
  reading.add(key)
  try {
    const answer = await bridge.readPetSheet(ref.source, ref.id)
    if (!answer.ok) {
      looks.set(key, { status: 'missing', reason: answer.error.message })
      return
    }
    const { bytes, rows } = answer.data
    // Copied into a buffer of its own: the bytes arrive as a view a Blob will not take as it is.
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }))
    const frameWidth = image.width / PET_COLUMNS
    const frameHeight = image.height / rows
    looks.set(key, { status: 'ready', atlas: { image, rows, frameWidth, frameHeight, body: bodyOf(image, rows, frameWidth, frameHeight) } })
  } catch {
    // It read and would not draw: the last word on a sheet is the window's own decode.
    looks.set(key, { status: 'missing', reason: 'Its sheet is on this computer but would not draw.' })
  } finally {
    reading.delete(key)
    changed()
  }
}

/** A pet's look, read on first use. Undefined for no pet. */
export function usePetLook(ref: PetRef | undefined): PetLook | undefined {
  const key = ref === undefined ? undefined : petKey(ref)
  const look = useSyncExternalStore(
    subscribe,
    () => (ref === undefined ? undefined : petLook(ref)),
    () => (ref === undefined ? undefined : petLook(ref))
  )
  useEffect(() => {
    if (ref !== undefined) void ensurePet(ref)
    // The key is the pet: a new object for the same pet reads nothing again.
  }, [key])
  return look
}

/* ---- The pets on this computer, for the look picker. ---- */

let list: readonly PublicPet[] | undefined
let listError: string | undefined
let listReading: Promise<void> | undefined

export function petList(): readonly PublicPet[] | undefined {
  return list
}

export function petListError(): string | undefined {
  return listError
}

/** Read the list again: after a pet is added or removed, or when the picker opens. */
export function refreshPetList(): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop
  if (bridge === undefined) return Promise.resolve()
  listReading ??= (async () => {
    try {
      const answer = await bridge.listPets()
      if (answer.ok) {
        list = answer.data.pets
        listError = undefined
      } else {
        listError = answer.error.message
      }
    } catch {
      listError = 'The pets on this computer could not be read; they are still there, and nothing was changed.'
    } finally {
      listReading = undefined
      changed()
    }
  })()
  return listReading
}

/** The pets on this computer, read when first asked for. */
export function usePetList(): { readonly pets: readonly PublicPet[] | undefined; readonly error: string | undefined } {
  const pets = useSyncExternalStore(subscribe, petList, petList)
  const error = useSyncExternalStore(subscribe, petListError, petListError)
  useEffect(() => {
    void refreshPetList()
  }, [])
  return { pets, error }
}
