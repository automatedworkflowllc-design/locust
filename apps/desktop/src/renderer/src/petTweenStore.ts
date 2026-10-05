/**
 * THE IN-BETWEENS, KEPT ON THIS COMPUTER (2026-10-05, petTweens.ts).
 *
 * Making a pet's in-betweens costs a few seconds of the computer's time over
 * its first minutes at work -- several times that on a slow or busy machine
 * -- so each is made once and kept here, in the window's own storage
 * (IndexedDB), as a compressed image: a pair of drawings made into in-betweens
 * once is drawn from storage every time after, on every launch. They are kept
 * by the drawings' own pixels (a fingerprint of each), so a maker's new sheet
 * makes new ones, and by TWEEN_VERSION, so better ones replace them. Nothing
 * here leaves the computer: they are made from the sheet it downloaded.
 */

/** Bumped whenever the in-betweens are made differently: older ones are then made again. */
export const TWEEN_VERSION = 1

const DATABASE = 'locust-pet-tweens'
const STORE = 'tweens'

/** A drawing's fingerprint: FNV-1a over its pixels. */
export function pixelPrint(pixels: Uint8ClampedArray): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < pixels.length; i += 1) {
    hash ^= pixels[i] ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Where the in-betweens from one drawing to another are kept. */
export function tweenKey(from: Uint8ClampedArray, to: Uint8ClampedArray): string {
  return `${String(TWEEN_VERSION)}:${pixelPrint(from)}:${pixelPrint(to)}`
}

let opening: Promise<IDBDatabase | undefined> | undefined

function database(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(undefined)
        return
      }
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
  return opening
}

/** The in-betweens kept under `key`, as images; undefined when none are, or storage cannot be read. */
export async function keptTweens(key: string): Promise<readonly Blob[] | undefined> {
  const db = await database()
  if (db === undefined) return undefined
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => {
        const value: unknown = request.result
        resolve(Array.isArray(value) && value.every((one) => one instanceof Blob) ? (value as Blob[]) : undefined)
      }
      request.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

/** Keeps the in-betweens under `key`; a failure to keep them only means they are made again next time. */
export async function keepTweens(key: string, images: readonly Blob[]): Promise<void> {
  const db = await database()
  if (db === undefined) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put([...images], key)
  } catch {
    // Storage full or refused: they are made again next launch.
  }
}
