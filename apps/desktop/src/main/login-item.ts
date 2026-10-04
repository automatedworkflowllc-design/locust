/**
 * Start Locust when you sign in to Windows.
 *
 * Set with `app.setLoginItemSettings({ openAtLogin, path: process.execPath,
 * args: ['--background'] })`. Read back from `app.getLoginItemSettings()`
 * every time Settings opens, so the switch shows what Windows holds.
 *
 * Packaged builds only: in development it would register electron.exe.
 */

export const BACKGROUND_ARG = '--background'

export interface LoginItemQuery {
  readonly path: string
  readonly args: string[]
}

/** The slice of Electron's `app` this module needs. Injected so a test can fake it. */
export interface LoginItemHost {
  setLoginItemSettings(settings: { openAtLogin: boolean; path: string; args: string[] }): void
  getLoginItemSettings(query: LoginItemQuery): { readonly openAtLogin: boolean }
}

export interface LoginItemOptions {
  readonly host: LoginItemHost
  /** A packaged build. Development must not register electron.exe. */
  readonly packaged: boolean
  readonly execPath: string
  readonly platform: string
}

export interface LoginItemState {
  readonly openAtLogin: boolean
  /** False in development and off Windows: the switch does not write a Run key. */
  readonly available: boolean
}

export interface LoginItem {
  read(): LoginItemState
  /** Writes, then reads back, so the answer is what the host reports. */
  set(openAtLogin: boolean): LoginItemState
}

const unavailable: LoginItemState = { openAtLogin: false, available: false }

export function createLoginItem(options: LoginItemOptions): LoginItem {
  const available = options.packaged && options.platform === 'win32'
  const query = (): LoginItemQuery => ({ path: options.execPath, args: [BACKGROUND_ARG] })
  return {
    read() {
      if (!available) return unavailable
      return { openAtLogin: options.host.getLoginItemSettings(query()).openAtLogin === true, available: true }
    },
    set(openAtLogin) {
      if (!available) return unavailable
      options.host.setLoginItemSettings({ openAtLogin, ...query() })
      return this.read()
    }
  }
}
