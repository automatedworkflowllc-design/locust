import { describe, expect, it } from 'vitest'

import { BACKGROUND_ARG, createLoginItem } from './login-item.js'
import type { LoginItemHost, LoginItemQuery } from './login-item.js'

/**
 * "Start Locust when you sign in to Windows."
 *
 * Set with app.setLoginItemSettings({ openAtLogin, path: process.execPath,
 * args: ['--background'] }). Read back from app.getLoginItemSettings() so the
 * switch shows what Windows holds. Packaged builds only: in development it
 * would register electron.exe.
 */

function host(): LoginItemHost & { readonly sets: { openAtLogin: boolean; path: string; args: string[] }[]; held: { openAtLogin: boolean } } {
  const sets: { openAtLogin: boolean; path: string; args: string[] }[] = []
  const state = { held: { openAtLogin: false } }
  return {
    sets,
    get held() {
      return state.held
    },
    set held(next) {
      state.held = next
    },
    setLoginItemSettings(settings) {
      sets.push(settings)
      state.held = { openAtLogin: settings.openAtLogin }
    },
    getLoginItemSettings(query: LoginItemQuery) {
      expect(query).toEqual({ path: 'C:\\Locust\\Locust.exe', args: [BACKGROUND_ARG] })
      return state.held
    }
  }
}

const packaged = (fake: LoginItemHost) =>
  createLoginItem({ host: fake, packaged: true, execPath: 'C:\\Locust\\Locust.exe', platform: 'win32' })

describe('the login item', () => {
  it('sets --background on the packaged executable and reads back what the host holds', () => {
    const fake = host()
    const item = packaged(fake)
    expect(item.read()).toEqual({ openAtLogin: false, available: true })
    expect(item.set(true)).toEqual({ openAtLogin: true, available: true })
    expect(fake.sets).toEqual([{ openAtLogin: true, path: 'C:\\Locust\\Locust.exe', args: ['--background'] }])
    fake.held = { openAtLogin: false }
    expect(item.read()).toEqual({ openAtLogin: false, available: true })
    expect(item.set(false).openAtLogin).toBe(false)
    expect(fake.sets.at(-1)).toMatchObject({ openAtLogin: false, args: ['--background'] })
  })

  it('does not register electron.exe from a development build, or off Windows', () => {
    const dev = host()
    const item = createLoginItem({ host: dev, packaged: false, execPath: 'C:\\electron\\electron.exe', platform: 'win32' })
    expect(item.set(true)).toEqual({ openAtLogin: false, available: false })
    expect(item.read()).toEqual({ openAtLogin: false, available: false })
    expect(dev.sets).toEqual([])
    const mac = host()
    expect(createLoginItem({ host: mac, packaged: true, execPath: '/Locust', platform: 'darwin' }).set(true).available).toBe(false)
    expect(mac.sets).toEqual([])
  })
})
