import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { mayShowToasts } from './stale-shortcut.js'

/**
 * A DRIVE SHOWS NO OS NOTIFICATION, SO IT CLAIMS NO START-MENU SHORTCUT.
 *
 * 2026-09-23: a drive of a packaged build in a worktree raised the "waiting on
 * you" notice for an Antigravity question; Electron pointed Colin's Start-menu
 * "Locust" at that worktree; his installed copy updated and was relaunched
 * through it -- so he ran the drive's copy, and it held the folder the next
 * release had to be packaged in (see stale-shortcut.ts).
 */
describe('a scripted launch', () => {
  it('shows no toast', () => {
    expect(mayShowToasts(['C:\\x\\Locust.exe', '--remote-debugging-port=9402', '--user-data-dir=C:\\scratch'])).toBe(false)
    expect(mayShowToasts(['electron.exe', 'C:/app/', '--remote-debugging-port', '9304'])).toBe(false)
  })

  it('while a person launching Locust still gets them, after an update too', () => {
    expect(mayShowToasts(['C:\\Users\\x\\AppData\\Local\\Programs\\Locust\\Locust.exe'])).toBe(true)
    expect(mayShowToasts(['C:\\Users\\x\\AppData\\Local\\Programs\\Locust\\Locust.exe', '--updated'])).toBe(true)
  })

  it('is what the attention surface asks before it shows one', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    expect(source).toContain('supported: () => Notification.isSupported() && mayShowToasts(process.argv)')
  })
})
