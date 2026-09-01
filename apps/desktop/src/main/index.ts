import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron'
import {
  createNodeProbeRunner,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator,
  discoverInstalledRuntimes
} from '@teammate/runtime-adapters'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedger } from '@teammate/mission-store'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexMissionService } from './codex-mission.js'
import { createTeammateStore } from './teammate-store.js'
import { readMissionHistory } from './mission-history.js'
import type { CodexMissionService } from './codex-mission.js'
import { createRuntimeDiscoveryService, RUNTIME_DISCOVERY_CHANNEL } from './runtime-discovery.js'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL,
  MISSION_HISTORY_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL
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
const ownsSingleInstanceLock = app.requestSingleInstanceLock()
let missionServiceForShutdown: CodexMissionService | undefined
let ledgerForShutdown: MissionLedger | undefined

const isAllowedExternalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

const createWindow = (codexMissions: CodexMissionService): void => {
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
    codexMissions.interrupt()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!ownsSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'

    // The renderer is untrusted: it gets no device or web-platform permissions,
    // and packaged builds get no network egress at all (the dev server needs
    // loopback HTTP/WebSocket for Vite and HMR, so that stays dev-only).
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    session.defaultSession.setPermissionCheckHandler(() => false)
    if (app.isPackaged) {
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (_details, respond) => {
          respond({ cancel: true })
        }
      )
    }
    const missionLedger = createFileMissionLedger({
      rootDirectory: join(app.getPath('userData'), 'mission-ledger')
    })
    const codexMissions = createCodexMissionService({
      workspacePath: process.cwd(),
      discover: discoverRuntimes,
      runner: createNodeRuntimeProcessRunner(),
      ledger: missionLedger
    })
    const teammates = createTeammateStore({ rootDirectory: app.getPath('userData') })
    missionServiceForShutdown = codexMissions
    ledgerForShutdown = missionLedger

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

    // Every teammate channel validates its sender the same way the mission
    // channels do: a top-level frame of a window this process owns, never a
    // subframe. The roster is local data, but it is still a write surface.
    const fromOwnWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
      BrowserWindow.fromWebContents(event.sender) !== null
      && event.senderFrame !== null
      && event.senderFrame.parent === null

    const teammatesUnavailable = {
      ok: false,
      error: { code: 'TEAMMATES_UNAVAILABLE', message: 'The local teammate roster could not be read.' }
    } as const

    const teammateRejected = (message: string) =>
      ({ ok: false, error: { code: 'TEAMMATE_REJECTED', message } }) as const

    ipcMain.handle(TEAMMATE_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return teammatesUnavailable
      try {
        const [list, missionOwners] = await Promise.all([teammates.list(), teammates.missionOwners()])
        return { ok: true, data: { teammates: list, missionOwners } } as const
      } catch {
        return teammatesUnavailable
      }
    })

    ipcMain.handle(TEAMMATE_CREATE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return teammateRejected('The teammate could not be created.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        const teammate = await teammates.create({ name: input.name, hue: input.hue, role: input.role })
        return { ok: true, data: { teammate } } as const
      } catch {
        // The store's own validation is the authority; the renderer is told
        // that it was refused, never why in terms it could probe.
        return teammateRejected('That teammate could not be created. Check the name, hue and role.')
      }
    })

    ipcMain.handle(TEAMMATE_REMOVE_CHANNEL, async (event, teammateId: unknown) => {
      if (!fromOwnWindow(event)) return teammateRejected('The teammate could not be removed.')
      try {
        await teammates.remove(teammateId)
        return { ok: true, data: {} } as const
      } catch {
        return teammateRejected('That teammate could not be removed.')
      }
    })

    ipcMain.handle(TEAMMATE_ASSIGN_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return teammateRejected('The mission could not be assigned.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        await teammates.assignMission(input.teammateId, input.missionId)
        return { ok: true, data: {} } as const
      } catch {
        return teammateRejected('That mission could not be assigned.')
      }
    })

    ipcMain.handle(MISSION_HISTORY_CHANNEL, async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
        return {
          ok: false,
          error: {
            code: 'HISTORY_UNAVAILABLE',
            message: 'Local mission history could not be read.'
          }
        } as const
      }
      return readMissionHistory(missionLedger)
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

    const windowFromValidSender = (event: Electron.IpcMainEvent): BrowserWindow | undefined => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || !event.senderFrame || event.senderFrame.parent !== null) return undefined
      return window
    }
    ipcMain.on('window:minimize', (event) => {
      windowFromValidSender(event)?.minimize()
    })
    ipcMain.on('window:toggle-maximize', (event) => {
      const window = windowFromValidSender(event)
      if (!window) return
      window.isMaximized() ? window.unmaximize() : window.maximize()
    })
    ipcMain.on('window:close', (event) => {
      windowFromValidSender(event)?.close()
    })

    createWindow(codexMissions)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(codexMissions)
    })
  }).catch((error: unknown) => {
    console.error('Failed to initialize Teammate', error)
    app.exit(1)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shutdownStarted = false
let shutdownComplete = false
if (ownsSingleInstanceLock) {
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    void (async () => {
      await missionServiceForShutdown?.dispose()
      await ledgerForShutdown?.flush()
      shutdownComplete = true
      app.quit()
    })().catch((error: unknown) => {
      console.error('Failed to flush the local mission ledger during shutdown', error)
      app.exit(1)
    })
  })
}
