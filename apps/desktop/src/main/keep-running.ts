import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Keep Locust running in the background when the window is closed.
 *
 * Off unless the person turned it on. The file is the whole preference:
 * missing, unreadable, or anything but `true` is off.
 */

export const BACKGROUND_FILE = 'background.json'

export interface KeepRunningState {
  readonly keepRunning: boolean
}

export function keepRunningFrom(value: unknown): KeepRunningState {
  if (typeof value !== 'object' || value === null) return { keepRunning: false }
  return { keepRunning: (value as { readonly keepRunning?: unknown }).keepRunning === true }
}

export function readKeepRunning(file: string): boolean {
  try {
    return keepRunningFrom(JSON.parse(readFileSync(file, 'utf8'))).keepRunning
  } catch {
    return false
  }
}

export function writeKeepRunning(file: string, keepRunning: boolean): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ keepRunning })}\n`, 'utf8')
}
