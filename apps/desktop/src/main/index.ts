import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
import {
  createNodeProbeRunner,
  killProcessTree,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator,
  discoverInstalledRuntimes
} from '@teammate/runtime-adapters'
import { createFileMissionLedger, createFileWorkroom } from '@teammate/mission-store'
import type { MissionLedger, Workroom } from '@teammate/mission-store'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexMissionService } from './codex-mission.js'
import { createAppServerMissionService, PeerRecordError } from './app-server-mission.js'
import { createModelCatalog } from './model-catalog.js'
import { createTeammateStore } from './teammate-store.js'
import { deleteMissionRecord, readMissionHistory } from './mission-history.js'
import type { CodexMissionService } from './codex-mission.js'
import type { AppServerMissionService } from './app-server-mission.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { createRelay } from './relay.js'
import type { Relay } from './relay.js'
import { createRuntimeDiscoveryService, RUNTIME_DISCOVERY_CHANNEL } from './runtime-discovery.js'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL,
  MISSION_APPROVAL_CHANNEL,
  MISSION_APPROVAL_DECIDE_CHANNEL,
  MISSION_HANDOFF_CHANNEL,
  APP_INFO_CHANNEL,
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_STATE_CHANNEL,
  MISSION_DELETE_CHANNEL,
  MISSION_PRUNE_CHANNEL,
  MISSION_STORAGE_CHANNEL,
  MISSION_HISTORY_CHANNEL,
  MODEL_CATALOG_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  WORKSPACE_SETTINGS_READ_CHANNEL,
  WORKSPACE_SETTINGS_WRITE_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL,
  TEAMMATE_UPDATE_CHANNEL
} from '../shared/ipc.js'
import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import { isMissionRuntime, runtimeDisplayName } from '../shared/runtimes.js'
import { pruneMissionRecords, readStorageReport } from './retention.js'
import { createUpdateService } from './updates.js'
import type {
  CodexMissionCancelRequest,
  CodexMissionStartRequest,
  CodexMissionUpdate,
  MissionMode,
  PublicTeammate,
  MissionHandoffRequest
} from '../shared/ipc.js'

const probeRunner = createNodeProbeRunner()
const executableLocator = createPathExecutableLocator()
const discoverRuntimes = () => discoverInstalledRuntimes({
  runner: probeRunner,
  locator: executableLocator,
  includeOmniRoute: true
})
/**
 * One probe sweep, shared.
 *
 * Discovery spawns a version probe and a capability probe per runtime -- ten
 * or more child processes. The cached service below was wired to the UI
 * channel alone, so every mission start, every model-catalog read and every
 * app-server start re-ran the whole sweep, BEFORE any of the checks that
 * might refuse the request. A window could drive that in a loop with a
 * runtime the host was always going to turn down.
 *
 * Ten seconds is the same window the UI already accepts, and a runtime that
 * is installed or signed into mid-session appears on the next read.
 */
const DISCOVERY_TTL_MS = 10_000
let discoveryCache: { readonly at: number; readonly value: readonly RuntimeDiscovery[] } | undefined
let discoveryInFlight: Promise<readonly RuntimeDiscovery[]> | undefined

const discoverForWork = (): Promise<readonly RuntimeDiscovery[]> => {
  const held = discoveryCache
  if (held !== undefined && Date.now() - held.at < DISCOVERY_TTL_MS) return Promise.resolve(held.value)
  if (discoveryInFlight !== undefined) return discoveryInFlight
  const running = discoverRuntimes()
    .then((value) => {
      discoveryCache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      discoveryInFlight = undefined
    })
  discoveryInFlight = running
  return running
}

const runtimeDiscovery = createRuntimeDiscoveryService({
  probe: discoverForWork
})
const ownsSingleInstanceLock = app.requestSingleInstanceLock()
let missionServiceForShutdown: CodexMissionService | undefined
let appServerServiceForShutdown: AppServerMissionService | undefined
let ledgerForShutdown: MissionLedger | undefined
let workroomForShutdown: Workroom | undefined

/**
 * The renderer names no destinations.
 *
 * `window.open` used to reach `shell.openExternal` for anything with an
 * `https:` or `mailto:` protocol. That is a hole straight through the egress
 * rules this file works to keep: the packaged build cancels every renderer
 * request and refuses every permission, but `openExternal` hands the URL to
 * the operating system, where none of that applies. Anything running in the
 * renderer could have posted the mission ledger to a host of its choosing,
 * one browser launch at a time.
 *
 * Nothing in this shell links out, so nothing is opened. A future feature
 * that needs a link should name the exact URL here, in the host, rather than
 * accept one from the window.
 */

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
    // The Locust mark, rasterised by `_tools/render-icon.cjs`. Resolved from
    // the build output, which sits two levels below the app directory both in
    // dev and in the unpackaged build; a packaged build will carry its own
    // `.ico` when packaging exists.
    icon: join(__dirname, '../../resources/icon.png'),
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  window.webContents.on('will-navigate', (event, url) => {
    const activeUrl = window.webContents.getURL()
    if (url !== activeUrl) event.preventDefault()
  })

  window.once('closed', () => {
    codexMissions.interrupt()
    // The app-server transport was only ever stopped on quit, and macOS does
    // not quit when the last window closes. Its runs are the write-capable
    // ones, and once the window is gone their approval requests reach nobody:
    // the run cannot finish, cannot be stopped, and pins a ledger record that
    // then refuses to be deleted.
    void appServerServiceForShutdown?.dispose().catch(() => undefined)
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
    // Bound late: the relay starts runs through the service that calls it.
    let relay: Relay | undefined
    const codexMissions = createCodexMissionService({
      workspacePath: process.cwd(),
      discover: discoverForWork,
      runner: createNodeRuntimeProcessRunner(),
      ledger: missionLedger,
      workroom,
      onShared: async (mission, posted) => {
        await relay?.onShared(mission, posted)
      },
      onRunEnded: async (mission) => {
        await relay?.onRunEnded(mission)
      }
    })
    // The approval transport. It only runs for the mode that asked for it, so
    // an experimental protocol failing cannot take the ordinary paths with it.
    let approvalWindow: BrowserWindow | undefined
    const sendToWindow = (update: CodexMissionUpdate): void => {
      const target = approvalWindow
      if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
        target.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
      }
    }

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
              killProcessTree(child.pid)
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
      discover: discoverForWork,
      spawn: spawnAppServer
    })

    const appServerMissions = createAppServerMissionService({
      workspacePath: process.cwd(),
      ledger: missionLedger,
      discover: discoverForWork,
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
      },
      emitUpdate: (update) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
        }
      },
      workroom
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
      const entry = (teammate: PublicTeammate) => ({
        teammateId: teammate.teammateId,
        name: teammate.name,
        role: teammate.role,
        ...(teammate.route === undefined ? {} : { route: teammate.route })
      })
      return {
        self: entry(self),
        others: roster.filter((other) => other.teammateId !== teammateId).map(entry)
      }
    }

    // Ownership is recorded by the host, once, after a start succeeded -- so
    // the roster and the ledger cannot disagree about who a mission belongs
    // to because a renderer forgot to say.
    const assignOwner = async (teammateId: string | undefined, missionId: string): Promise<void> => {
      if (teammateId === undefined) return
      await teammates.assignMission(teammateId, missionId).catch(() => undefined)
    }
    // A PERSON starting a teammate on a route is what makes it theirs. A run
    // the relay starts for them never re-records it, so a fallback onto the
    // sender's route cannot quietly become the recipient's own.
    const rememberRoute = async (
      teammateId: string | undefined,
      route: { readonly runtime: MissionRuntimeId; readonly model: string; readonly mode: MissionMode }
    ): Promise<void> => {
      if (teammateId === undefined) return
      await teammates.rememberRoute(teammateId, route).catch(() => undefined)
    }

    // Teammates replying to each other. Off unless the workspace switched it
    // on; every hop is a run the service starts like any other, under the
    // recipient's name, on the sender's route.
    relay = createRelay({
      enabled: async () => (await teammates.readSettings()).relay === true,
      peerContextFor,
      start: (input) =>
        codexMissions.start(
          input.prompt,
          input.runtime,
          input.mode,
          input.model === undefined ? {} : { model: input.model },
          sendToWindow,
          undefined,
          input.peer,
          input.followUpOf,
          input.relay
        ),
      assignOwner: (teammateId, missionId) => assignOwner(teammateId, missionId),
      notify: sendToWindow
    })

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
      if (!fromOwnWindow(event)) return { swarm: false, relay: true } as const
      try {
        return await teammates.readSettings()
      } catch {
        // An unreadable switch reads as its default: swarm off, replies on.
        return { swarm: false, relay: true } as const
      }
    })

    ipcMain.handle(WORKSPACE_SETTINGS_WRITE_CHANNEL, async (event, settings: unknown) => {
      if (!fromOwnWindow(event)) return { swarm: false, relay: true } as const
      try {
        return await teammates.writeSettings(settings)
      } catch {
        return { swarm: false, relay: true } as const
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
        const teammate = await teammates.create({ name: input.name, hue: input.hue, role: input.role, avatar: input.avatar })
        return { ok: true, data: { teammate } } as const
      } catch {
        // The store's own validation is the authority; the renderer is told
        // that it was refused, never why in terms it could probe.
        return teammateRejected('That teammate could not be created. Check the name, hue and role.')
      }
    })

    ipcMain.handle(TEAMMATE_UPDATE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return teammateRejected('The teammate could not be updated.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        const teammate = await teammates.update({
          teammateId: input.teammateId,
          name: input.name,
          hue: input.hue,
          role: input.role,
          avatar: input.avatar
        })
        return { ok: true, data: { teammate } } as const
      } catch {
        return teammateRejected('That teammate could not be updated. Check the name, hue and role.')
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

    ipcMain.handle(APP_INFO_CHANNEL, (event) => {
      if (!fromOwnWindow(event)) return { name: 'Locust', version: 'unknown', packaged: app.isPackaged, platform: process.platform } as const
      // The version electron-builder stamped, which is the one on the installer.
      return { name: 'Locust', version: app.getVersion(), packaged: app.isPackaged, platform: process.platform } as const
    })

    // Updates. A packaged build can replace itself; a development build
    // cannot, and says so rather than reporting itself up to date.
    const updates = createUpdateService({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      supported: app.isPackaged,
      liveMissionCount: () =>
        codexMissions.liveMissionIds().length + appServerMissions.liveMissionIds().length,
      onStateChange: (state) => {
        for (const target of BrowserWindow.getAllWindows()) {
          if (!target.isDestroyed()) target.webContents.send(APP_UPDATE_STATE_CHANNEL, state)
        }
      }
    })
    // One check a few seconds after launch, so a person is told a new version
    // exists without ever being asked to go looking.
    setTimeout(() => {
      void updates.check()
    }, 8_000)

    ipcMain.handle(APP_UPDATE_CHECK_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request was rejected.' } } as const
      }
      return updates.check()
    })

    ipcMain.handle(APP_UPDATE_INSTALL_CHANNEL, (event) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request was rejected.' } } as const
      }
      return updates.install()
    })

    ipcMain.handle(MISSION_STORAGE_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) {
        return {
          ok: false,
          error: { code: 'STORAGE_UNAVAILABLE', message: 'The request was rejected.' }
        } as const
      }
      return readStorageReport(missionLedger)
    })

    ipcMain.handle(MISSION_PRUNE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request was rejected.' } } as const
      }
      const response = await pruneMissionRecords(
        missionLedger,
        request,
        () => [...codexMissions.liveMissionIds(), ...appServerMissions.liveMissionIds()],
        () => new Date()
      )
      // Ownership follows the records out, exactly as it does for a single
      // deletion, so the roster never lists a mission that no longer exists.
      if (response.ok && !response.data.previewed) {
        for (const missionId of response.data.deleted) {
          await teammates.unassignMission(missionId).catch(() => undefined)
        }
      }
      return response
    })

    ipcMain.handle(MISSION_DELETE_CHANNEL, async (event, missionId: unknown) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The deletion was rejected.' } } as const
      }
      const response = await deleteMissionRecord(
        missionLedger,
        missionId,
        (id) => codexMissions.hasMission(id) || appServerMissions.hasMission(id)
      )
      // Ownership follows the record out, so the roster never lists a
      // mission that no longer exists.
      if (response.ok && typeof missionId === 'string') {
        await teammates.unassignMission(missionId).catch(() => undefined)
      }
      return response
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
      const runtime = isMissionRuntime(payload.runtime) ? payload.runtime : 'codex'
      // `approve-each` is the only mode that needs a runtime able to stop and
      // ask, so it is the only one routed to the experimental transport --
      // which is Codex's app-server. Another runtime asked for it would have
      // been started on Codex without a word; it is refused instead.
      if (mode === 'approve-each' && runtime !== 'codex') {
        return {
          ok: false,
          error: {
            code: 'RUNTIME_START_FAILED',
            message: `Per-action approvals run on Codex CLI only. Pick another mode for ${runtimeDisplayName(runtime)}, or switch the route.`
          }
        } as const
      }
      if (mode === 'approve-each') {
        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
          return { ok: false, error: { code: 'INVALID_PROMPT', message: 'Enter a mission first.' } } as const
        }
        const peer = await peerContextFor(payload.teammateId)
        const approveModel = typeof payload.model === 'string' ? payload.model : undefined
        const approveEffort = typeof payload.effort === 'string' ? payload.effort : undefined
        try {
          const mission = await appServerMissions.start(prompt, peer, {
            ...(approveModel === undefined ? {} : { model: approveModel }),
            ...(approveEffort === undefined ? {} : { effort: approveEffort })
          })
          await assignOwner(peer?.self.teammateId, mission.missionId)
          await rememberRoute(peer?.self.teammateId, { runtime: 'codex', model: approveModel ?? 'account-default', mode })
          return {
            ok: true,
            data: {
              runId: mission.runId,
              missionId: mission.missionId,
              runtime: 'codex',
              model: approveModel !== undefined && approveModel !== 'account-default' ? approveModel : 'account-default',
              resolvedRouteId: 'codex-app-server:default',
              cliVersion: null,
              sandbox: 'workspace-write',
              peerMessages: mission.peerMessages,
              peerDeliveryFailed: mission.peerDeliveryFailed
            }
          } as const
        } catch (error) {
          if (error instanceof PeerRecordError) {
            return { ok: false, error: { code: 'PERSISTENCE_FAILED', message: error.message } } as const
          }
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
        const followUpOf = typeof payload.followUpOf === 'string' ? payload.followUpOf : undefined
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
          peer,
          followUpOf
        )
        if (response.ok) {
          await assignOwner(peer?.self.teammateId, response.data.missionId)
          await rememberRoute(peer?.self.teammateId, { runtime, model: model ?? 'account-default', mode })
        }
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
      const viaExec = codexMissions.cancel(runId)
      if (viaExec.ok || typeof runId !== 'string') return viaExec
      // Not an exec run: the approval transport owns its own runs, and a stop
      // control that only knew one transport reported "no longer active" at a
      // run that was very much still going.
      if (appServerMissions.cancel(runId)) {
        return { ok: true, data: { runId, state: 'cancellation-requested' } } as const
      }
      return viaExec
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
      const runtime = isMissionRuntime(payload.runtime) ? payload.runtime : 'codex'
      const model = typeof payload.model === 'string' ? payload.model : undefined
      const effort = typeof payload.effort === 'string' ? payload.effort : undefined
      // An approve-each run cannot be handed off yet, and saying "no longer
      // active" about a run that is still going would be a lie. Refused
      // without touching the run.
      if (typeof payload.runId === 'string' && appServerMissions.has(payload.runId)) {
        return {
          ok: false,
          error: {
            code: 'HANDOFF_REFUSED',
            message: 'A mission running with per-action approvals cannot be handed to another runtime yet. It is still running.'
          }
        } as const
      }
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
