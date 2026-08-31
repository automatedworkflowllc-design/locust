import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import {
  createNodeProbeRunner,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator,
  discoverInstalledRuntimes
} from '@teammate/runtime-adapters'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexMissionService } from './codex-mission.js'
import { createRuntimeDiscoveryService, RUNTIME_DISCOVERY_CHANNEL } from './runtime-discovery.js'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL
} from '../shared/ipc.js'
import type {
  CodexMissionCancelRequest,
  CodexMissionStartRequest,
  CodexMissionUpdate
} from '../shared/ipc.js'

const probeRunner = createNodeProbeRunner()
const executableLocator = createPathExecutableLocator()
const discoverRuntimes = () => discoverInstalledRuntimes({
  runner: probeRunner,
  locator: executableLocator,
  includeOmniRoute: true
})
const runtimeDiscovery = createRuntimeDiscoveryService({
  probe: discoverRuntimes
})
const codexMissions = createCodexMissionService({
  workspacePath: process.cwd(),
  discover: discoverRuntimes,
  runner: createNodeRuntimeProcessRunner()
})

const isAllowedExternalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#090a0c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()

    const capturePath = app.isPackaged ? undefined : process.env.TEAMMATE_CAPTURE_PATH
    if (capturePath) {
      void (async () => {
        await delay(8_000)
        const image = await window.webContents.capturePage()
        await writeFile(capturePath, image.toPNG())
        app.quit()
      })().catch((error: unknown) => {
        console.error('Failed to capture the Teammate window', error)
        app.exit(1)
      })
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const activeUrl = window.webContents.getURL()
    if (url !== activeUrl) event.preventDefault()
  })

  window.once('closed', () => {
    codexMissions.dispose()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'

  ipcMain.handle(RUNTIME_DISCOVERY_CHANNEL, (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
      return {
        ok: false,
        error: {
          code: 'DISCOVERY_FAILED',
          message: 'Local runtime discovery could not complete.'
        }
      } as const
    }
    return runtimeDiscovery.get()
  })

  ipcMain.handle(CODEX_MISSION_START_CHANNEL, async (event, request: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The Codex mission request was rejected.'
        }
      } as const
    }

    const prompt = typeof request === 'object' && request !== null
      ? (request as Partial<CodexMissionStartRequest>).prompt
      : undefined
    try {
      return await codexMissions.start(prompt, (update: CodexMissionUpdate) => {
        if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
          owner.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
        }
      })
    } catch {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The Codex mission could not be started.'
        }
      } as const
    }
  })

  ipcMain.handle(CODEX_MISSION_CANCEL_CHANNEL, (event, request: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The cancellation request was rejected.'
        }
      } as const
    }
    const runId = typeof request === 'object' && request !== null
      ? (request as Partial<CodexMissionCancelRequest>).runId
      : undefined
    return codexMissions.cancel(runId)
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    window.isMaximized() ? window.unmaximize() : window.maximize()
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  codexMissions.dispose()
})
