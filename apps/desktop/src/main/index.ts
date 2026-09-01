import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron'
import {
  createNodeProbeRunner,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator,
  discoverInstalledRuntimes
} from '@teammate/runtime-adapters'
import { createFileMissionLedger, createFileWorkroom } from '@teammate/mission-store'
import type { MissionLedger, Workroom } from '@teammate/mission-store'
import { execFileSync, spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexMissionService } from './codex-mission.js'
import { createAppServerMissionService } from './app-server-mission.js'
import { createModelCatalog } from './model-catalog.js'
import { createTeammateStore } from './teammate-store.js'
import { readMissionHistory } from './mission-history.js'
import type { CodexMissionService } from './codex-mission.js'
import type { AppServerMissionService } from './app-server-mission.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { createRuntimeDiscoveryService, RUNTIME_DISCOVERY_CHANNEL } from './runtime-discovery.js'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL,
  MISSION_APPROVAL_CHANNEL,
  MISSION_APPROVAL_DECIDE_CHANNEL,
  MISSION_HANDOFF_CHANNEL,
  MISSION_HISTORY_CHANNEL,
  MODEL_CATALOG_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  WORKSPACE_SETTINGS_READ_CHANNEL,
  WORKSPACE_SETTINGS_WRITE_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL
} from '../shared/ipc.js'
import type {
  CodexMissionCancelRequest,
  CodexMissionStartRequest,
  CodexMissionUpdate,
  MissionHandoffRequest
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
let appServerServiceForShutdown: AppServerMissionService | undefined
let ledgerForShutdown: MissionLedger | undefined
let workroomForShutdown: Workroom | undefined

const isAllowedExternalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

const createWindow = (
  codexMissions: CodexMissionService,
  onWindow: (window: BrowserWindow) => void
): void => {
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

  onWindow(window)

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
    // Its own directory: the ledger treats every `.jsonl` in ITS directory as
    // a mission, and the channel is not one.
    const workroom = createFileWorkroom({
      rootDirectory: join(app.getPath('userData'), 'workroom')
    })
    const codexMissions = createCodexMissionService({
      workspacePath: process.cwd(),
      discover: discoverRuntimes,
      runner: createNodeRuntimeProcessRunner(),
      ledger: missionLedger,
      workroom
    })
    // The approval transport. It only runs for the mode that asked for it, so
    // an experimental protocol failing cannot take the ordinary paths with it.
    let approvalWindow: BrowserWindow | undefined

    // One definition of how an app-server process is started and stopped, used
    // by both the mission transport and the model probe. Killing the TREE
    // matters: app-server starts children that outlive their parent.
    const spawnAppServer = (executablePath: string, args: readonly string[]) => {
      const child = spawn(executablePath, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      return {
        write: (line: string) => child.stdin.write(line),
        kill: () => {
          try {
            if (process.platform === 'win32' && child.pid !== undefined) {
              execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
              return
            }
          } catch {
            // Fall through to the ordinary signal.
          }
          child.kill()
        },
        onData: (listener: (chunk: string) => void) =>
          child.stdout.on('data', (chunk: Buffer) => listener(String(chunk))),
        onExit: (listener: () => void) => child.on('exit', () => listener())
      }
    }

    const modelCatalog = createModelCatalog({
      discover: discoverRuntimes,
      spawn: spawnAppServer
    })

    const appServerMissions = createAppServerMissionService({
      workspacePath: process.cwd(),
      ledger: missionLedger,
      discover: discoverRuntimes,
      spawn: spawnAppServer,
      emitApproval: (request) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(MISSION_APPROVAL_CHANNEL, request)
        }
      },
      emitEvent: (runId, missionId, event) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, { kind: 'event', runId, missionId, event })
        }
      }
    })

    ipcMain.handle(MODEL_CATALOG_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'Models could not be read.' } } as const
      }
      return modelCatalog.read()
    })

    ipcMain.handle(MISSION_APPROVAL_DECIDE_CHANNEL, (event, answer: unknown) => {
      if (!fromOwnWindow(event)) return { ok: false } as const
      const payload = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>
      const decision = payload.decision
      // Anything but a recognized answer is a refusal. A malformed message must
      // never be able to approve an action.
      const normalized =
        decision === 'approve-once' || decision === 'approve-always' ? decision : 'deny'
      if (typeof payload.approvalId !== 'string') return { ok: false } as const
      return { ok: appServerMissions.decide({ approvalId: payload.approvalId, decision: normalized }) } as const
    })

    const teammates = createTeammateStore({ rootDirectory: app.getPath('userData') })
    missionServiceForShutdown = codexMissions
    appServerServiceForShutdown = appServerMissions
    ledgerForShutdown = missionLedger
    workroomForShutdown = workroom

    /**
     * Who a mission is messaged to, resolved by the host from the roster it
     * reads itself. The renderer only names an id; an id that is nobody yields
     * a mission that belongs to nobody, never a guessed teammate.
     */
    const peerContextFor = async (teammateId: unknown): Promise<MissionPeerContext | undefined> => {
      if (typeof teammateId !== 'string' || teammateId.length === 0) return undefined
      let roster
      try {
        roster = await teammates.list()
      } catch {
        return undefined
      }
      const self = roster.find((entry) => entry.teammateId === teammateId)
      if (self === undefined) return undefined
      return {
        self: { teammateId: self.teammateId, name: self.name, role: self.role },
        others: roster
          .filter((entry) => entry.teammateId !== teammateId)
          .map((entry) => ({ teammateId: entry.teammateId, name: entry.name, role: entry.role }))
      }
    }

    // Ownership is recorded by the host, once, after a start succeeded -- so
    // the roster and the ledger cannot disagree about who a mission belongs
    // to because a renderer forgot to say.
    const assignOwner = async (teammateId: string | undefined, missionId: string): Promise<void> => {
      if (teammateId === undefined) return
      await teammates.assignMission(teammateId, missionId).catch(() => undefined)
    }

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

    ipcMain.handle(WORKSPACE_SETTINGS_READ_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return { swarm: false } as const
      try {
        return await teammates.readSettings()
      } catch {
        // An unreadable switch reads as off. That is the safe direction.
        return { swarm: false } as const
      }
    })

    ipcMain.handle(WORKSPACE_SETTINGS_WRITE_CHANNEL, async (event, settings: unknown) => {
      if (!fromOwnWindow(event)) return { swarm: false } as const
      try {
        return await teammates.writeSettings(settings)
      } catch {
        return { swarm: false } as const
      }
    })

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
      return readMissionHistory(missionLedger, workroom)
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

      const payload = (typeof request === 'object' && request !== null ? request : {}) as Partial<CodexMissionStartRequest>
      const prompt = payload.prompt
      // Anything but an explicit accept-edits is read-only. A malformed or
      // missing mode must never widen what a run may touch.
      const mode =
        payload.mode === 'accept-edits' || payload.mode === 'approve-each' ? payload.mode : 'ask'
      // Same shape as the mode: an unrecognized runtime falls back to Codex
      // rather than being passed through to discovery as-is.
      const runtime = payload.runtime === 'claude' ? 'claude' : 'codex'
      // `approve-each` is the only mode that needs a runtime able to stop and
      // ask, so it is the only one routed to the experimental transport.
      if (mode === 'approve-each') {
        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
          return { ok: false, error: { code: 'INVALID_PROMPT', message: 'Enter a mission first.' } } as const
        }
        try {
          const mission = await appServerMissions.start(prompt)
          // The approval transport does not take part in the workroom yet:
          // the mission is still the teammate's, but it is shown no messages
          // and shares none, and the receipt says so with an empty list.
          await assignOwner(await peerContextFor(payload.teammateId).then((peer) => peer?.self.teammateId), mission.missionId)
          return {
            ok: true,
            data: {
              runId: mission.runId,
              missionId: mission.missionId,
              runtime: 'codex',
              model: 'account-default',
              resolvedRouteId: 'codex-app-server:default',
              cliVersion: null,
              sandbox: 'workspace-write',
              peerMessages: [],
              peerDeliveryFailed: false
            }
          } as const
        } catch {
          return {
            ok: false,
            error: {
              code: 'RUNTIME_START_FAILED',
              message: 'The approval-capable runtime could not be started.'
            }
          } as const
        }
      }

      const model = typeof payload.model === 'string' ? payload.model : undefined
      const effort = typeof payload.effort === 'string' ? payload.effort : undefined
      try {
        const peer = await peerContextFor(payload.teammateId)
        const response = await codexMissions.start(
          prompt,
          runtime,
          mode,
          { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) },
          (update: CodexMissionUpdate) => {
            if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
              owner.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
            }
          },
          undefined,
          peer
        )
        if (response.ok) await assignOwner(peer?.self.teammateId, response.data.missionId)
        return response
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

    ipcMain.handle(MISSION_HANDOFF_CHANNEL, async (event, request: unknown) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'The handoff request was rejected.' }
        } as const
      }
      const payload = (typeof request === 'object' && request !== null ? request : {}) as Partial<MissionHandoffRequest>
      // Same widening rules as a start: an unrecognized mode is read-only and
      // an unrecognized runtime is Codex. A handoff must not become the way a
      // malformed request buys itself write access.
      const mode = payload.mode === 'accept-edits' ? 'accept-edits' : 'ask'
      const runtime = payload.runtime === 'claude' ? 'claude' : 'codex'
      const model = typeof payload.model === 'string' ? payload.model : undefined
      const effort = typeof payload.effort === 'string' ? payload.effort : undefined
      try {
        const response = await codexMissions.handOff(
          payload.runId,
          runtime,
          mode,
          { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) },
          (update: CodexMissionUpdate) => {
            if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
              owner.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
            }
          }
        )
        if (response.ok) {
          // The continuation belongs to whoever the stopped mission did.
          const owners = await teammates.missionOwners().catch(() => ({}) as Readonly<Record<string, string>>)
          await assignOwner(owners[response.data.continuesFrom.missionId], response.data.missionId)
        }
        return response
      } catch {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'The mission could not be handed off.' }
        } as const
      }
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

    createWindow(codexMissions, (window) => {
      approvalWindow = window
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(codexMissions, (window) => {
          approvalWindow = window
        })
      }
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
      // Releases any pending approval and takes the app-server process tree
      // with it, so nothing is left prompting for an app that has gone.
      await appServerServiceForShutdown?.dispose()
      await ledgerForShutdown?.flush()
      await workroomForShutdown?.flush()
      shutdownComplete = true
      app.quit()
    })().catch((error: unknown) => {
      console.error('Failed to flush the local mission ledger during shutdown', error)
      app.exit(1)
    })
  })
}
