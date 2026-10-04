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
  /** Which of those it is (0.587), so the switch's note can say so. */
  readonly why?: 'development' | 'platform'
}

export interface LoginItem {
  read(): LoginItemState
  /** Writes, then reads back, so the answer is what the host reports. */
  set(openAtLogin: boolean): LoginItemState
}

/** Off, and why (0.587): a development copy would register Electron; off Windows there is nothing to register yet. */
const unavailableFor = (platform: string): LoginItemState => ({ openAtLogin: false, available: false, why: platform === 'win32' ? 'development' : 'platform' })

export function createLoginItem(options: LoginItemOptions): LoginItem {
  const available = options.packaged && options.platform === 'win32'
  const query = (): LoginItemQuery => ({ path: options.execPath, args: [BACKGROUND_ARG] })
  return {
    read() {
      if (!available) return unavailableFor(options.platform)
      return { openAtLogin: options.host.getLoginItemSettings(query()).openAtLogin === true, available: true }
    },
    set(openAtLogin) {
      if (!available) return unavailableFor(options.platform)
      options.host.setLoginItemSettings({ openAtLogin, ...query() })
      return this.read()
    }
  }
}
