import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from './window-size.js'
import { APP_USER_MODEL_ID, DEVELOPMENT_APP_USER_MODEL_ID, sweepStaleElectronShortcuts } from './stale-shortcut.js'
import { openingPlacement, readSavedWindow } from './window-bounds.js'
import type { SavedWindow } from './window-bounds.js'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, screen, session, shell } from 'electron'
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
import { appendFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexMissionService } from './codex-mission.js'
import { createAppServerMissionService, PeerRecordError } from './app-server-mission.js'
import { createModelCatalog } from './model-catalog.js'
import { createTeammateStore } from './teammate-store.js'
import { createRoutineStore } from './routine-store.js'
import { createRoomStore } from './room-store.js'
import { createRoomTasks } from './room-tasks.js'
import type { RoomTasks } from './room-tasks.js'
import { taskSection } from '../shared/room-task.js'
import { createRoutineRunner } from './routine-runner.js'
import { createMemoryStore } from './memory-store.js'
import { createWorktreeManager } from './worktrees.js'
import { readRuntimeSetup } from './runtime-setup.js'
import { briefSection, readWorkspaceBrief } from './workspace-brief.js'
import { createMemoryReader } from './memory-reader.js'
import { createAttentionReader } from './attention-reader.js'
import type { AttentionReader } from './attention-reader.js'
import type { MemoryReader } from './memory-reader.js'
import type { MemoryBriefing } from './peer-exchange.js'
import { memorySection } from '../shared/memory.js'

/** Scheduled routines are checked once a minute; the first check waits for runtime discovery. */
const ROUTINE_TICK_MS = 60_000
const ROUTINE_FIRST_TICK_MS = 15_000
import type { RoutineRunner } from './routine-runner.js'
import { deleteMissionRecord, readMissionHistory } from './mission-history.js'
import type { CodexMissionService } from './codex-mission.js'
import type { AppServerMissionService } from './app-server-mission.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { createRelay } from './relay.js'
import { createAttention } from './attention.js'
import { isInsideDirectory, readRememberedWorkspace, resolveWorkspacePath, WORKSPACE_ARGUMENT, writeRememberedWorkspace, workspaceIdFor } from './workspace.js'
import { createAntigravityHostProbe } from './antigravity-host.js'
import { AntigravityStartError, createAntigravityMissionService } from './antigravity-mission.js'
import type { Relay } from './relay.js'
import { createRuntimeDiscoveryService, RUNTIME_DISCOVERY_CHANNEL } from './runtime-discovery.js'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL,
  MISSION_APPROVAL_CHANNEL,
  MISSION_APPROVAL_DECIDE_CHANNEL,
  MISSION_HANDOFF_CHANNEL,
  MISSION_RESUME_CHANNEL,
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
  ROUTINE_LIST_CHANNEL,
  ROUTINE_CREATE_CHANNEL,
  ROUTINE_UPDATE_CHANNEL,
  ROUTINE_REMOVE_CHANNEL,
  ROUTINE_RUN_CHANNEL,
  MEMORY_LIST_CHANNEL,
  MEMORY_ADD_CHANNEL,
  MEMORY_UPDATE_CHANNEL,
  MEMORY_REMOVE_CHANNEL,
  MEMORY_CLEAR_CHANNEL,
  RUNTIME_SETUP_CHANNEL,
  WORKTREE_LIST_CHANNEL,
  WORKTREE_REMOVE_CHANNEL,
  WORKSPACE_SETTINGS_READ_CHANNEL,
  WORKSPACE_SETTINGS_WRITE_CHANNEL,
  WORKSPACE_CHOOSE_CHANNEL,
  DEFAULT_RELAY_HOP_CAP,
  DEFAULT_MEMORY_MODE,
  ROOM_LIST_CHANNEL,
  ROOM_CREATE_CHANNEL,
  ROOM_REMOVE_CHANNEL,
  ROOM_POST_CHANNEL,
  ROOM_TASK_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL,
  TEAMMATE_UPDATE_CHANNEL
} from '../shared/ipc.js'
import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import { isMissionRuntime, runtimeDisplayName } from '../shared/runtimes.js'
import { roleLabelOf } from '../shared/ipc.js'
import { pruneMissionRecords, readStorageReport } from './retention.js'
import { createUpdateService } from './updates.js'
import type {
  CodexMissionCancelRequest,
  CodexMissionStartData,
  CodexMissionStartRequest,
  CodexMissionUpdate,
  MissionMode,
  PublicTeammate,
  MissionHandoffRequest,
  MissionResumeRequest
} from '../shared/ipc.js'

const probeRunner = createNodeProbeRunner()
// `LOCUST_HIDE_RUNTIMES=1` is a test seam: the first-run drive needs a
// machine with nothing installed, and this one has everything.
const executableLocator = process.env.LOCUST_HIDE_RUNTIMES === '1'
  ? { find: async () => undefined }
  : createPathExecutableLocator()
// Antigravity has no CLI probe: its readiness is whether the app is open,
// which the host checks itself and merges into the same sweep.
const antigravityProbe = createAntigravityHostProbe()
const discoverRuntimes = async (): Promise<readonly RuntimeDiscovery[]> => {
  const [found, antigravity] = await Promise.all([
    discoverInstalledRuntimes({ runner: probeRunner, locator: executableLocator, includeOmniRoute: true }),
    antigravityProbe.discoveryRecord().catch(() => undefined)
  ])
  return antigravity === undefined ? found : [...found, antigravity]
}
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


/**
 * Where the remembered window goes. Its own file rather than a key in the
 * roster: losing it costs a window position, and it must never be able to
 * take the roster down with it.
 */
const windowFile = (): string => join(app.getPath('userData'), 'window.json')

const readWindowFile = (): SavedWindow | undefined => {
  try {
    return readSavedWindow(JSON.parse(readFileSync(windowFile(), 'utf8')))
  } catch {
    // No file on first launch, and a corrupt one is the same answer: open
    // where a first launch would. Nothing here is worth a startup failure.
    return undefined
  }
}

/**
 * Save the window's shape as the person changes it.
 *
 * Written on a timer rather than per event -- a drag emits `move` for every
 * frame, and writing the file that often would beat the disk for no gain. The
 * final write on close is what makes the last position stick.
 */
const rememberWindow = (window: BrowserWindow): void => {
  let pending: NodeJS.Timeout | undefined

  const save = (): void => {
    if (window.isDestroyed()) return
    // `getNormalBounds` is the un-maximized shape, which is what a maximized
    // window needs to remember: restoring maximized is a flag, and the size
    // underneath it is what un-maximizing goes back to.
    const bounds = window.getNormalBounds()
    const record: SavedWindow = { ...bounds, maximized: window.isMaximized() }
    void writeFile(windowFile(), JSON.stringify(record), 'utf8').catch(() => {
      // A window position is not worth surfacing an error over.
    })
  }

  const later = (): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(save, 500)
  }

  window.on('resize', later)
  window.on('move', later)
  window.on('maximize', later)
  window.on('unmaximize', later)
  window.on('close', () => {
    if (pending) clearTimeout(pending)
    save()
  })
}

const createWindow = (
  codexMissions: CodexMissionService,
  onWindow: (window: BrowserWindow) => void
): void => {
  const opening = openingPlacement(
    readWindowFile(),
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workAreaSize
  )
  const window = new BrowserWindow({
    width: opening.width,
    height: opening.height,
    ...(opening.x === undefined || opening.y === undefined ? {} : { x: opening.x, y: opening.y }),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    center: opening.x === undefined,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#090a0c',
    // The Locust mark, rasterised by `_tools/render-icon.cjs`. Resolved from
    // the build output, which sits two levels below the app directory both in
    // dev and in the unpackaged build; a packaged build will carry its own
    // `.ico` when packaging exists.
    // The 512, not the 256 beside it. Windows scales the window and taskbar
    // icon from whatever it is handed, so handing it the smaller file made it
    // downsample from a downsample. Found by the design pass, 2026-09-04.
    // Packaged: the .ico copied BESIDE the archive (electron-builder.yml,
    // extraResources), never a path inside it. Two wrong turns, both seen on
    // Colin's taskbar as Electron's own emblem: 0.32.0 handed a PNG inside
    // app.asar, which Windows cannot make a window icon from; 0.33.1 handed
    // nothing, assuming Windows would take the executable's icon -- it does
    // for shortcuts, not for a running window (2026-09-06: "it's literally
    // showing the electron emblem"). Development keeps the PNG.
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(__dirname, '../../resources/icon-512.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  onWindow(window)

  window.once('ready-to-show', () => {
    // Maximize before showing: maximizing a visible window is a visible jump.
    if (opening.maximized) window.maximize()
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

  rememberWindow(window)

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

/**
 * The last thing that must never be silent. An exception nobody caught in
 * the main process used to close the app with no word at all: a beta user
 * would see Locust vanish and not know whether their records survived.
 * They do -- the ledger is append-only and flushed on every write -- so the
 * dialog says so, names the log, and the app goes on unless it cannot.
 */
const errorLog = (): string => join(app.getPath('userData'), 'locust-errors.log')
let toldAboutTrouble = false
const noteTrouble = (label: string, error: unknown): void => {
  const detail = error instanceof Error ? `${error.stack ?? error.message}` : String(error)
  const line = `${new Date().toISOString()} ${label}: ${detail}\n`
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    appendFileSync(errorLog(), line, 'utf8')
  } catch {
    // Nowhere to write; the dialog still says what happened.
  }
  if (toldAboutTrouble) return
  toldAboutTrouble = true
  try {
    dialog.showErrorBox(
      'Locust hit a problem',
      `Something went wrong inside Locust. Your mission records are safe on disk.\n\n${detail.split('\n')[0] ?? ''}\n\nDetails were written to ${errorLog()}.`
    )
  } catch {
    // Before the app is ready a dialog cannot show; the log has it.
  }
}
process.on('uncaughtException', (error) => noteTrouble('uncaughtException', error))
process.on('unhandledRejection', (reason) => noteTrouble('unhandledRejection', reason))

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
    // Windows shows a notification only for an app it can name. Development
    // runs get an id of their own: a dev electron.exe once left a Start-menu
    // shortcut carrying the installed app's id, and Windows drew Electron's
    // atom on every Locust window from then on (see stale-shortcut.ts).
    if (process.platform === 'win32') {
      app.setAppUserModelId(app.isPackaged ? APP_USER_MODEL_ID : DEVELOPMENT_APP_USER_MODEL_ID)
      if (app.isPackaged) {
        const removed = sweepStaleElectronShortcuts({
          candidates: [join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk')],
          appId: APP_USER_MODEL_ID,
          readShortcut: (path) => {
            if (!existsSync(path)) return undefined
            const link = shell.readShortcutLink(path)
            return { target: link.target, ...(link.appUserModelId === undefined ? {} : { appUserModelId: link.appUserModelId }) }
          },
          remove: (path) => unlinkSync(path)
        })
        for (const path of removed) console.warn(`Removed a stale Electron shortcut that carried Locust's app id: ${path}`)
      }
    }

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
    // The folder the teammates work in. The install folder is never it: the
    // Start menu launches the app from there, and until 0.21.5 every teammate
    // on an installed build worked inside AppData\Local\Programs\Locust. With
    // no folder chosen the services still need SOME absolute path to bind,
    // so they get the launch folder -- and every way of starting a run below
    // is refused until a folder is picked, so nothing ever runs in it.
    // `LOCUST_INSTALL_DIR` is a test seam: a development build has no install
    // folder, and the smoke that proves the refusal needs to name one.
    const installDirectory = app.isPackaged
      ? dirname(app.getPath('exe'))
      : process.env.LOCUST_INSTALL_DIR === undefined || process.env.LOCUST_INSTALL_DIR.length === 0
        ? undefined
        : process.env.LOCUST_INSTALL_DIR
    const rememberedWorkspaceFile = join(app.getPath('userData'), 'workspace.json')
    // With nothing chosen, Locust makes a folder rather than refusing the
    // first message (Colin, 2026-09-05). `LOCUST_DEFAULT_WORKSPACE` is the
    // test seam, so a smoke never creates the real Documents\Locust.
    const defaultWorkspace =
      process.env.LOCUST_DEFAULT_WORKSPACE !== undefined && process.env.LOCUST_DEFAULT_WORKSPACE.length > 0
        ? process.env.LOCUST_DEFAULT_WORKSPACE
        : join(app.getPath('documents'), 'Locust')
    const resolved = resolveWorkspacePath({
      argv: process.argv,
      cwd: process.cwd(),
      installDirectory,
      remembered: readRememberedWorkspace(rememberedWorkspaceFile),
      defaultWorkspace,
      platform: process.platform
    })
    // A default that cannot be made falls back to the old answer: no
    // workspace, every start refused with the reason. Never a crash at boot.
    const workspace = ((): typeof resolved => {
      if (resolved.source !== 'default' || resolved.path === undefined) return resolved
      try {
        mkdirSync(resolved.path, { recursive: true })
        return resolved
      } catch {
        return { path: undefined, source: 'none' }
      }
    })()
    const workspaceChosen = workspace.path !== undefined
    const workspaceMade = workspace.source === 'default'
    const workspacePath = workspace.path ?? process.cwd()
    const NO_WORKSPACE_MESSAGE =
      'Choose the folder your teammates work in first. Locust was opened from its own install folder, and no teammate should work in there.'
    const noWorkspaceRefusal = () =>
      workspaceChosen ? undefined : ({ ok: false, error: { code: 'NO_WORKSPACE', message: NO_WORKSPACE_MESSAGE } } as const)

    const missionLedger = createFileMissionLedger({
      rootDirectory: join(app.getPath('userData'), 'mission-ledger')
    })
    // Its own directory: the ledger treats every `.jsonl` in ITS directory as
    // a mission, and the channel is not one.
    // Team memory: kept per folder in the app's own data, briefed to every
    // teammate mission, written by a reply's memory block. Colin's call
    // (2026-09-05): the shared memory Claude Code and Cursor keep, managed
    // from the app -- so every memory names who, where and from what.
    const memories = createMemoryStore({ rootDirectory: app.getPath('userData') })
    const memoryWorkspaceId = workspaceChosen ? workspaceIdFor(workspacePath) : 'ws_none'
    const memoryWorkspaceName = workspaceChosen ? basename(workspacePath) || workspacePath : 'no folder'
    // The folder's own LOCUST.md rides in the same slot, first: read fresh at
    // every start so an edit lands on the next mission (parity row 45).
    const memoryBriefing: MemoryBriefing = {
      section: async (peer) => {
        if (!workspaceChosen) return undefined
        const sections: string[] = []
        const brief = await readWorkspaceBrief(workspacePath).catch(() => undefined)
        // A teammate with a worktree is not standing in the folder that
        // name belongs to, and saying otherwise sends it looking.
        if (brief !== undefined) sections.push(briefSection(brief, peer.cwd === undefined ? memoryWorkspaceName : undefined))
        const settings = await teammates.readSettings()
        if (settings.memoryMode !== 'off') sections.push(await memoryPart(peer))
        return sections.length === 0 ? undefined : sections.join('\n\n')
      }
    }
    async function memoryPart(peer: MissionPeerContext): Promise<string> {
        const settings = await teammates.readSettings()
        const listed = await memories.briefed(memoryWorkspaceId)
        return memorySection({
          selfName: peer.self.name,
          workspaceName: memoryWorkspaceName,
          memories: listed.map((memory) => ({
            text: memory.text,
            scope: memory.scope,
            by: memory.by.name,
            where: memory.scope === 'global' && memory.workspaceId !== memoryWorkspaceId ? memory.workspaceName : undefined
          })),
          askFirst: settings.memoryMode === 'ask'
        })
    }
    const workroom = createFileWorkroom({
      rootDirectory: join(app.getPath('userData'), 'workroom')
    })
    // Bound late: the relay starts runs through the service that calls it.
    let relay: Relay | undefined
    let routineRunner: RoutineRunner | undefined
    let memoryReader: MemoryReader | undefined
    let attentionReader: AttentionReader | undefined
    // Bound late for the same reason: it reads the ledger the service writes.
    let roomTasks: RoomTasks | undefined
    const codexMissions = createCodexMissionService({
      workspacePath,
      // Asked at the moment a run starts, never cached: switching Auto off in
      // Settings has to reach the next run, including one a relay or a saved
      // routine is about to start.
      autoModeAllowed: async () => (await teammates.readSettings()).autoMode === true,
      discover: discoverForWork,
      runner: createNodeRuntimeProcessRunner(),
      ledger: missionLedger,
      workroom,
      memory: memoryBriefing,
      onShared: async (mission, posted) => {
        await relay?.onShared(mission, posted)
      },
      onRunEnded: async (mission) => {
        await relay?.onRunEnded(mission)
        await routineRunner?.onRunEnded(mission)
        await roomTasks?.onRunEnded(mission)
        await memoryReader?.onRunEnded(mission)
        await attentionReader?.onRunEnded(mission)
      }
    })
    // The approval transport. It only runs for the mode that asked for it, so
    // an experimental protocol failing cannot take the ordinary paths with it.
    let approvalWindow: BrowserWindow | undefined
    const attention = createAttention({
      focused: () => {
        const target = approvalWindow
        return target !== undefined && !target.isDestroyed() && target.isFocused() && !target.isMinimized()
      },
      supported: () => Notification.isSupported(),
      notify: ({ title, body, onClick }) => {
        const toast = new Notification({ title, body })
        toast.on('click', onClick)
        toast.show()
      },
      focusWindow: () => {
        const target = approvalWindow
        if (target === undefined || target.isDestroyed()) return
        if (target.isMinimized()) target.restore()
        target.show()
        target.focus()
      }
    })
    // Antigravity, experimental: driven through the running app, watched
    // through its transcript. Its own service, so its heuristics cannot leak
    // into the transports that read a process.
    const antigravityMissions = createAntigravityMissionService({
      workspacePath,
      ledger: missionLedger,
      workroom,
      memory: memoryBriefing,
      probe: () => antigravityProbe.probe(),
      emitEvent: (runId, missionId, event) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, { kind: 'event', runId, missionId, event })
        }
      },
      emitUpdate: (update) => sendToWindow(update),
      onShared: async (mission, posted) => {
        await relay?.onShared(mission, posted)
      },
      onRunEnded: async (mission) => {
        await relay?.onRunEnded(mission)
        await routineRunner?.onRunEnded(mission)
        await roomTasks?.onRunEnded(mission)
        await memoryReader?.onRunEnded(mission)
        await attentionReader?.onRunEnded(mission)
      }
    })
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
      workspacePath,
      ledger: missionLedger,
      discover: discoverForWork,
      spawn: spawnAppServer,
      emitApproval: (request) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(MISSION_APPROVAL_CHANNEL, request)
        }
        // A run stopped waiting on a person who is looking elsewhere is told
        // through the OS, by name, and the click brings the window back.
        void teammates
          .missionOwners()
          .then(async (owners) => {
            const ownerId = owners[request.missionId]
            const roster = ownerId === undefined ? [] : await teammates.list()
            attention.approvalArrived(request, roster.find((entry) => entry.teammateId === ownerId)?.name)
          })
          .catch(() => attention.approvalArrived(request, undefined))
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
      workroom,
      memory: memoryBriefing
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
    // A teammate with "Own branch" on runs in its own worktree of the
    // folder's repository. Resolved here, once per start, because every
    // start for a teammate -- a person's message, a relay, a routine, a room
    // post -- builds its peer context through this one function.
    const worktrees = workspaceChosen ? createWorktreeManager({ workspacePath }) : undefined
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
        // What the runtime is told this teammate does: a Custom teammate's
        // own words, so the brief says "Wren (release manager)" rather than
        // "Wren (Custom)".
        role: roleLabelOf(teammate),
        ...(teammate.route === undefined ? {} : { route: teammate.route })
      })
      let cwd: string | undefined
      let worktreeRefused: string | undefined
      // Antigravity works in the folder it has open; a worktree would be one it has not.
      if (self.worktree === true && worktrees !== undefined && self.route?.runtime !== 'antigravity') {
        try {
          cwd = await worktrees.ensure(self)
        } catch (error) {
          worktreeRefused = `${self.name} is set to work on its own branch, but ${error instanceof Error ? error.message : 'the worktree could not be made.'}`
        }
      }
      return {
        self: entry(self),
        others: roster.filter((other) => other.teammateId !== teammateId).map(entry),
        ...(cwd === undefined ? {} : { cwd }),
        ...(worktreeRefused === undefined ? {} : { worktreeRefused })
      }
    }

    const antigravityStartData = (mission: {
      readonly runId: string
      readonly missionId: string
      readonly model: string
      readonly cliVersion: string | null
      readonly peerMessages: CodexMissionStartData['peerMessages']
      readonly peerDeliveryFailed: boolean
      readonly followsUp?: { readonly missionId: string; readonly runtimeThreadId: string }
    }): CodexMissionStartData => ({
      runId: mission.runId,
      missionId: mission.missionId,
      runtime: 'antigravity',
      model: mission.model,
      resolvedRouteId: 'antigravity:hub',
      cliVersion: mission.cliVersion,
      sandbox: 'workspace-write',
      peerMessages: mission.peerMessages,
      peerDeliveryFailed: mission.peerDeliveryFailed,
      ...(mission.followsUp === undefined ? {} : { followsUp: mission.followsUp })
    })

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
      hopCap: async () => (await teammates.readSettings()).relayHopCap,
      peerContextFor,
      start: async (input) => {
        if (input.runtime === 'antigravity') {
          try {
            const mission = await antigravityMissions.start(input.prompt, input.peer, {
              ...(input.model === undefined ? {} : { model: input.model }),
              ...(input.followUpOf === undefined ? {} : { followUpOf: input.followUpOf }),
              relay: input.relay
            })
            return { ok: true, data: antigravityStartData(mission) } as const
          } catch (error) {
            return {
              ok: false,
              error: { code: 'RUNTIME_START_FAILED', message: error instanceof Error ? error.message : 'Antigravity could not start the mission.' }
            } as const
          }
        }
        return codexMissions.start(
          input.prompt,
          input.runtime,
          input.mode,
          input.model === undefined ? {} : { model: input.model },
          sendToWindow,
          undefined,
          input.peer,
          input.followUpOf,
          input.relay
        )
      },
      assignOwner: (teammateId, missionId) => assignOwner(teammateId, missionId),
      notify: sendToWindow
    })

    // Routines replay through the same start path a teammate's reply uses,
    // so a replayed step is a real mission on the teammate's own route, in
    // its own ledger, recorded as started by the routine.
    const routines = createRoutineStore({ rootDirectory: app.getPath('userData') })
    const rooms = createRoomStore({ rootDirectory: app.getPath('userData') })
    routineRunner = createRoutineRunner({
      routines,
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
          undefined,
          input.startedBy
        ),
      assignOwner: (teammateId, missionId) => assignOwner(teammateId, missionId),
      phaseOf: async (missionId) => (await missionLedger.getMission(missionId))?.phase,
      // A scheduled routine waits for any live run of the teammate's, whoever started it.
      teammateBusy: async (teammateId) => {
        const owners = await teammates.missionOwners()
        const live = [...codexMissions.liveMissionIds(), ...appServerMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()]
        return live.some((missionId) => owners[missionId] === teammateId)
      },
      notify: sendToWindow
    })
    // Scheduled routines: one tick a minute, the first after the runtimes
    // have had a moment to be discovered. Only with a project folder chosen
    // -- a run needs one, and a routine started into nothing would fail and
    // be held off an hour for a reason the person never saw.
    const tickRoutines = (): void => {
      if (!workspaceChosen || routineRunner === undefined) return
      void routineRunner.tick(new Date()).catch(() => undefined)
    }
    const firstRoutineTick = setTimeout(tickRoutines, ROUTINE_FIRST_TICK_MS)
    firstRoutineTick.unref()
    const routineTicks = setInterval(tickRoutines, ROUTINE_TICK_MS)
    routineTicks.unref()
    app.once('before-quit', () => {
      clearTimeout(firstRoutineTick)
      clearInterval(routineTicks)
    })
    // A run that ended waiting for the person -- a question card, an account
    // limit -- is said to the desk the way an approval is (parity row 62).
    attentionReader = createAttentionReader({
      ledger: missionLedger,
      teammates,
      attention: {
        decisionAsked: (name, question) => attention.decisionAsked(name, question),
        limitHit: (name, runtime, message) =>
          attention.limitHit(name, isMissionRuntime(runtime) ? runtimeDisplayName(runtime) : runtime, message)
      }
    })
    memoryReader = createMemoryReader({
      memories,
      ledger: missionLedger,
      teammates,
      workspaceName: memoryWorkspaceName,
      notify: sendToWindow
    })
    roomTasks = createRoomTasks({
      rooms,
      ledger: missionLedger,
      teammates,
      notify: (update) => {
        sendToWindow(update)
        // Also to the desk, when the person is elsewhere: gathered per room
        // so three teammates finishing together are one toast, not three.
        if (update.kind === 'room-changed') {
          attention.roomChanged({ roomId: update.roomId, roomName: update.roomName, message: update.message })
        }
      }
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
      if (!fromOwnWindow(event)) return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false } as const
      try {
        return await teammates.readSettings()
      } catch {
        // An unreadable switch reads as its default: swarm off, replies on.
        return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false } as const
      }
    })

    ipcMain.handle(WORKSPACE_CHOOSE_CHANNEL, async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (owner === null || !fromOwnWindow(event)) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The folder request was rejected.' } } as const
      }
      const picked = await dialog.showOpenDialog(owner, {
        title: 'Choose the folder your teammates work in',
        buttonLabel: 'Work here',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: workspaceChosen ? workspacePath : app.getPath('home')
      })
      const next = picked.filePaths[0]
      if (picked.canceled || next === undefined) {
        return { ok: false, error: { code: 'CANCELLED', message: 'No folder chosen.' } } as const
      }
      if (isInsideDirectory(next, installDirectory, process.platform)) {
        return {
          ok: false,
          error: {
            code: 'INSTALL_FOLDER',
            message: 'That is where Locust itself is installed. Pick a project folder instead.'
          }
        } as const
      }
      try {
        await writeRememberedWorkspace(rememberedWorkspaceFile, next)
      } catch {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'The chosen folder could not be saved.' }
        } as const
      }
      // Reopen there. Every service bound its folder at start-up and the
      // mission list is scoped by it, so the honest switch is a fresh start;
      // before-quit still runs, so live runs are stopped and the ledger is
      // flushed on the way out.
      app.relaunch({
        args: [...process.argv.slice(1).filter((entry) => !entry.startsWith(WORKSPACE_ARGUMENT)), `${WORKSPACE_ARGUMENT}${next}`]
      })
      setTimeout(() => app.quit(), 150)
      return { ok: true, data: { path: next, reopening: true } } as const
    })

    ipcMain.handle(WORKSPACE_SETTINGS_WRITE_CHANNEL, async (event, settings: unknown) => {
      if (!fromOwnWindow(event)) return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false } as const
      try {
        return await teammates.writeSettings(settings)
      } catch {
        return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false } as const
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
        // roleTitle was dropped here since Custom teammates got titles: every
        // one read "Custom" on the sidebar and in the brief (found 2026-09-05).
        const teammate = await teammates.create({ name: input.name, hue: input.hue, role: input.role, roleTitle: input.roleTitle, worktree: input.worktree, avatar: input.avatar })
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
          roleTitle: input.roleTitle,
          worktree: input.worktree,
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
        // Their routines had nobody left to run them.
        await routines.removeForTeammate(teammateId).catch(() => undefined)
        // And they leave every room; a room left empty goes with them.
        await rooms.removeTeammate(teammateId).catch(() => undefined)
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

    const routineRejected = (message: string) => ({ ok: false, error: { code: 'ROUTINE_REJECTED', message } }) as const

    // Rooms: a named set of teammates a person writes to at once. A post
    // starts one ordinary mission per teammate on that teammate's own
    // route, owned by them; the room remembers which. Nothing new reaches
    // the ledger (docs/FEATURES-FROM-VISION-2026-09-05.md, #2: "a surface,
    // not a new engine").
    const roomRejected = (message: string) => ({ ok: false, error: { code: 'ROOM_REJECTED', message } }) as const

    ipcMain.handle(ROOM_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return { ok: false, error: { code: 'ROOMS_UNAVAILABLE', message: 'Rooms are unavailable.' } } as const
      try {
        return { ok: true, data: { rooms: await rooms.list() } } as const
      } catch {
        return { ok: false, error: { code: 'ROOMS_UNAVAILABLE', message: 'Rooms could not be read.' } } as const
      }
    })

    ipcMain.handle(ROOM_CREATE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return roomRejected('The room could not be created.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        // Only teammates on the roster can be in a room.
        const roster = await teammates.list()
        const wanted = Array.isArray(input.teammateIds) ? input.teammateIds : []
        const known = wanted.filter((id) => roster.some((entry) => entry.teammateId === id))
        if (known.length !== wanted.length) return roomRejected('Every teammate in a room has to be on the roster.')
        const room = await rooms.create({ name: input.name, teammateIds: known })
        return { ok: true, data: { room } } as const
      } catch (error) {
        return roomRejected(error instanceof Error ? error.message : 'That room could not be created.')
      }
    })

    ipcMain.handle(ROOM_REMOVE_CHANNEL, async (event, roomId: unknown) => {
      if (!fromOwnWindow(event)) return roomRejected('The room could not be removed.')
      if (typeof roomId !== 'string') return roomRejected('That room could not be removed.')
      try {
        await rooms.remove(roomId)
        return { ok: true, data: {} } as const
      } catch {
        return roomRejected('That room could not be removed.')
      }
    })

    ipcMain.handle(ROOM_TASK_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return roomRejected('The board could not be changed.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      const op = input.op
      if (op !== 'add' && op !== 'assign' && op !== 'done' && op !== 'reopen' && op !== 'remove') {
        return roomRejected('That is not a way to move a task.')
      }
      if (typeof input.roomId !== 'string') return roomRejected('That room could not be found.')
      try {
        const room = await rooms.updateTask({
          roomId: input.roomId,
          op,
          ...(typeof input.taskId === 'string' ? { taskId: input.taskId } : {}),
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          ...(typeof input.ownerId === 'string' ? { ownerId: input.ownerId } : {})
        })
        return { ok: true, data: { room } } as const
      } catch (error) {
        return roomRejected(error instanceof Error ? error.message : 'The board could not be changed.')
      }
    })

    ipcMain.handle(ROOM_POST_CHANNEL, async (event, request: unknown) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (owner === null || !fromOwnWindow(event)) return roomRejected('The post could not be made.')
      const refused = noWorkspaceRefusal()
      if (refused !== undefined) return roomRejected(refused.error.message)
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      const roomId = typeof input.roomId === 'string' ? input.roomId : undefined
      const text = typeof input.text === 'string' ? input.text : ''
      if (roomId === undefined || text.trim().length === 0) return roomRejected('Write something to post.')
      const room = await rooms.get(roomId)
      if (room === undefined) return roomRejected('That room no longer exists.')

      // One run per teammate, each on THEIR route. A teammate with no route
      // of their own yet -- never started by a person -- runs on Codex's
      // account default in read-only, the same as a fresh teammate would.
      const started: Record<string, string> = {}
      const startedData: { teammateId: string; data: CodexMissionStartData }[] = []
      const refusals: { teammateId: string; name: string; message: string }[] = []
      const roster = await teammates.list()
      for (const teammateId of room.teammateIds) {
        const teammate = roster.find((entry) => entry.teammateId === teammateId)
        const peer = await peerContextFor(teammateId)
        if (teammate === undefined || peer === undefined) {
          refusals.push({ teammateId, name: teammate?.name ?? teammateId, message: 'No longer on the roster.' })
          continue
        }
        const route = teammate.route ?? { runtime: 'codex' as const, model: 'account-default', mode: 'ask' as const }
        // The person's words, then the board: which room this is, who else
        // is in it, every task as it stands, and how to move one. The room
        // keeps only the person's words as the post; this trailer is what
        // the mission is briefed with.
        const memberNames = room.teammateIds.map((id) => roster.find((entry) => entry.teammateId === id)?.name ?? id)
        const briefed = `${text}\n\n${taskSection({
          roomName: room.name,
          selfName: teammate.name,
          memberNames,
          tasks: room.tasks.map((task) => ({
            text: task.text,
            state: task.state,
            ownerName: task.ownerId === undefined ? undefined : roster.find((entry) => entry.teammateId === task.ownerId)?.name ?? task.ownerId
          }))
        })}`
        const response =
          route.runtime === 'antigravity'
            ? roomRejected('Antigravity cannot be posted to from a room yet.')
            : await codexMissions.start(
                briefed,
                route.runtime,
                route.mode,
                route.model === 'account-default' ? {} : { model: route.model },
                sendToWindow,
                undefined,
                peer,
                undefined,
                undefined,
                undefined
              )
        if (!response.ok) {
          refusals.push({ teammateId, name: teammate.name, message: response.error.message })
          continue
        }
        started[teammateId] = response.data.missionId
        startedData.push({ teammateId, data: response.data })
        await assignOwner(teammateId, response.data.missionId)
      }
      let post
      try {
        post = await rooms.addPost(roomId, { text, missions: started })
      } catch (error) {
        return roomRejected(error instanceof Error ? error.message : 'The post could not be recorded.')
      }
      // Now that the post has an id, tell the window which runs it started,
      // the way the relay and routines do, so the sidebar shows them working
      // at once and the room can file each run under its post.
      for (const entry of startedData) {
        sendToWindow({
          kind: 'mission-started',
          runId: entry.data.runId,
          missionId: entry.data.missionId,
          teammateId: entry.teammateId,
          prompt: text,
          data: entry.data,
          startedBy: { kind: 'room', roomId, postId: post.postId }
        })
      }
      return { ok: true, data: { post, refused: refusals } } as const
    })

    ipcMain.handle(ROUTINE_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return { ok: false, error: { code: 'ROUTINES_UNAVAILABLE', message: 'Routines are unavailable.' } } as const
      try {
        return { ok: true, data: { routines: await routines.list() } } as const
      } catch {
        return { ok: false, error: { code: 'ROUTINES_UNAVAILABLE', message: 'Routines could not be read.' } } as const
      }
    })

    ipcMain.handle(ROUTINE_CREATE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return routineRejected('The routine could not be saved.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        const routine = await routines.create({
          name: input.name,
          teammateId: input.teammateId,
          route: input.route,
          steps: input.steps,
          learnedFrom: input.learnedFrom,
          ...(input.schedule === undefined ? {} : { schedule: input.schedule })
        })
        return { ok: true, data: { routine } } as const
      } catch (error) {
        return routineRejected(error instanceof Error ? error.message : 'That routine could not be saved.')
      }
    })

    ipcMain.handle(ROUTINE_UPDATE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return routineRejected('The routine could not be changed.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        const routine = await routines.update({
          routineId: input.routineId,
          name: input.name,
          steps: input.steps,
          ...(input.schedule === undefined ? {} : { schedule: input.schedule })
        })
        return { ok: true, data: { routine } } as const
      } catch (error) {
        return routineRejected(error instanceof Error ? error.message : 'That routine could not be changed.')
      }
    })

    ipcMain.handle(ROUTINE_REMOVE_CHANNEL, async (event, routineId: unknown) => {
      if (!fromOwnWindow(event)) return routineRejected('The routine could not be removed.')
      try {
        await routines.remove(routineId)
        return { ok: true, data: {} } as const
      } catch {
        return routineRejected('That routine could not be removed.')
      }
    })

    ipcMain.handle(ROUTINE_RUN_CHANNEL, async (event, routineId: unknown) => {
      if (!fromOwnWindow(event)) return routineRejected('The routine could not be started.')
      if (typeof routineId !== 'string' || routineRunner === undefined) return routineRejected('That routine could not be started.')
      if (!workspaceChosen) return routineRejected(NO_WORKSPACE_MESSAGE)
      return routineRunner.run(routineId)
    })

    // Memory. Every answer carries the whole list so the screen never
    // shows a state the file does not hold.
    const memoryRejected = (message: string) => ({ ok: false, error: { code: 'MEMORY_REJECTED', message } }) as const
    const memoryList = async () =>
      ({ ok: true, data: { memories: await memories.list(), workspaceId: memoryWorkspaceId, workspaceName: memoryWorkspaceName } }) as const
    ipcMain.handle(MEMORY_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return memoryRejected('Memory could not be read.')
      try {
        return await memoryList()
      } catch {
        return memoryRejected('Memory could not be read.')
      }
    })
    ipcMain.handle(MEMORY_ADD_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return memoryRejected('The memory could not be kept.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        await memories.add({
          text: input.text,
          scope: input.scope,
          workspaceId: memoryWorkspaceId,
          workspaceName: memoryWorkspaceName,
          by: { name: 'you' },
          status: 'kept'
        })
        return await memoryList()
      } catch (error) {
        return memoryRejected(error instanceof Error ? error.message : 'The memory could not be kept.')
      }
    })
    ipcMain.handle(MEMORY_UPDATE_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return memoryRejected('The memory could not be changed.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        await memories.update({ memoryId: input.memoryId, text: input.text, enabled: input.enabled, keep: input.keep })
        return await memoryList()
      } catch (error) {
        return memoryRejected(error instanceof Error ? error.message : 'The memory could not be changed.')
      }
    })
    ipcMain.handle(MEMORY_REMOVE_CHANNEL, async (event, memoryId: unknown) => {
      if (!fromOwnWindow(event)) return memoryRejected('The memory could not be removed.')
      try {
        await memories.remove(memoryId)
        return await memoryList()
      } catch {
        return memoryRejected('The memory could not be removed.')
      }
    })
    ipcMain.handle(MEMORY_CLEAR_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return memoryRejected('Memory could not be cleared.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        await memories.clear(input.scope === 'all' ? {} : { workspaceId: memoryWorkspaceId })
        return await memoryList()
      } catch {
        return memoryRejected('Memory could not be cleared.')
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
      // The window's own folder decides which conversation it opens on.
      return readMissionHistory(missionLedger, workroom, workspacePath)
    })

    ipcMain.handle(APP_INFO_CHANNEL, (event) => {
      if (!fromOwnWindow(event)) return { name: 'Locust', version: 'unknown', packaged: app.isPackaged, platform: process.platform, workspaceName: '', workspacePath: '', workspaceMade: false } as const
      // The version electron-builder stamped, which is the one on the installer.
      return {
        name: 'Locust',
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        workspaceName: workspaceChosen ? basename(workspacePath) || workspacePath : '',
        workspacePath: workspaceChosen ? workspacePath : '',
        workspaceMade
      } as const
    })

    // Updates. A packaged build can replace itself; a development build
    // cannot, and says so rather than reporting itself up to date.
    const updates = createUpdateService({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      supported: app.isPackaged,
      liveMissionCount: () =>
        codexMissions.liveMissionIds().length + appServerMissions.liveMissionIds().length + antigravityMissions.liveMissionIds().length,
      requestQuit: (finalise) => {
        // Held for the shutdown handler: an installer can only be launched
        // once the ledger is safely on disk.
        quitFinaliser = finalise
        app.quit()
      },
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

    // The teammates' own worktrees: listed from git, removed on request when
    // no run is live in them. The branch stays either way.
    const worktreesRejected = (message: string) => ({ ok: false, error: { code: 'WORKTREES_UNAVAILABLE', message } }) as const
    const worktreeList = async () => {
      if (worktrees === undefined) return { ok: true, data: { worktrees: [], reason: 'No project folder is chosen.' } } as const
      const probe = await worktrees.probe()
      const [roster, owners] = await Promise.all([teammates.list(), teammates.missionOwners()])
      const live = new Set(
        [...codexMissions.liveMissionIds(), ...appServerMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()]
          .map((missionId) => owners[missionId])
          .filter((owner): owner is string => owner !== undefined)
      )
      const listed = (await worktrees.list()).map((tree) => ({
        teammateId: tree.teammateId,
        teammateName: roster.find((entry) => entry.teammateId === tree.teammateId)?.name,
        branch: tree.branch,
        path: tree.path,
        busy: live.has(tree.teammateId)
      }))
      return { ok: true, data: { worktrees: listed, reason: probe.reason } } as const
    }
    ipcMain.handle(WORKTREE_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return worktreesRejected('The request was rejected.')
      try {
        return await worktreeList()
      } catch {
        return worktreesRejected('The worktrees could not be listed.')
      }
    })
    ipcMain.handle(WORKTREE_REMOVE_CHANNEL, async (event, teammateId: unknown) => {
      if (!fromOwnWindow(event)) return worktreesRejected('The request was rejected.')
      if (typeof teammateId !== 'string' || worktrees === undefined) return worktreesRejected('That worktree could not be removed.')
      try {
        const current = await worktreeList()
        if (current.ok && current.data.worktrees.some((tree) => tree.teammateId === teammateId && tree.busy)) {
          return worktreesRejected('A run is live in that worktree. Stop it first.')
        }
        await worktrees.remove(teammateId)
        return await worktreeList()
      } catch (error) {
        return worktreesRejected(error instanceof Error ? error.message : 'That worktree could not be removed.')
      }
    })

    // What each runtime has set up for itself -- MCP servers and hooks --
    // read from its own files so nothing fires unseen (Colin, 2026-09-05).
    ipcMain.handle(RUNTIME_SETUP_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'SETUP_UNAVAILABLE', message: 'The request was rejected.' } } as const
      }
      try {
        const brief = workspaceChosen ? await readWorkspaceBrief(workspacePath).catch(() => undefined) : undefined
        return {
          ok: true,
          data: {
            runtimes: await readRuntimeSetup({ workspacePath: workspaceChosen ? workspacePath : undefined }),
            workspaceBrief: brief === undefined ? null : { lines: brief.lines, truncated: brief.truncated }
          }
        } as const
      } catch {
        return { ok: false, error: { code: 'SETUP_UNAVAILABLE', message: 'The runtimes\' own configuration could not be read.' } } as const
      }
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
        () => [...codexMissions.liveMissionIds(), ...appServerMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()],
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
        (id) => codexMissions.hasMission(id) || appServerMissions.hasMission(id) || antigravityMissions.hasMission(id)
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

      const refused = noWorkspaceRefusal()
      if (refused !== undefined) return refused
      const payload = (typeof request === 'object' && request !== null ? request : {}) as Partial<CodexMissionStartRequest>
      const prompt = payload.prompt
      // Anything but an explicit accept-edits is read-only. A malformed or
      // missing mode must never widen what a run may touch. `auto` is passed
      // through as itself and refused further in if the workspace has it
      // switched off -- one check, on the path every run takes, rather than
      // one here and another the relay could walk around.
      // `plan` travels as itself. It used to collapse into `ask` here, which
      // was harmless for PERMISSION -- both are read-only, and the sandbox is
      // decided from this same value -- but it meant the host, and therefore
      // the record, never knew a plan had been asked for. A plan reopened
      // after a restart came back as an ordinary read-only run and lost its
      // "Build this plan" offer (QA, 2026-09-06). Recording the mode was not
      // enough on its own: the word was already gone by the time anything
      // wrote it down, which is what a live drive found and the unit tests
      // could not.
      const mode =
        payload.mode === 'accept-edits'
        || payload.mode === 'approve-each'
        || payload.mode === 'auto'
        || payload.mode === 'plan'
          ? payload.mode
          : 'ask'
      // Same shape as the mode: an unrecognized runtime falls back to Codex
      // rather than being passed through to discovery as-is.
      const runtime = isMissionRuntime(payload.runtime) ? payload.runtime : 'codex'
      // `approve-each` is the only mode that needs a runtime able to stop and
      // ask, so it is the only one routed to the experimental transport --
      // which is Codex's app-server. Another runtime asked for it would have
      // been started on Codex without a word; it is refused instead.
      if (runtime === 'antigravity') {
        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
          return { ok: false, error: { code: 'INVALID_PROMPT', message: 'Enter a mission first.' } } as const
        }
        if (mode !== 'accept-edits') {
          return {
            ok: false,
            error: {
              code: 'RUNTIME_START_FAILED',
              message: "Antigravity runs its own agent with its own permissions; Locust cannot hold it read-only. Choose Accept edits, or another route."
            }
          } as const
        }
        const peer = await peerContextFor(payload.teammateId)
        const model = typeof payload.model === 'string' ? payload.model : undefined
        const followUpOf = typeof payload.followUpOf === 'string' ? payload.followUpOf : undefined
        try {
          const mission = await antigravityMissions.start(prompt, peer, {
            ...(model === undefined ? {} : { model }),
            ...(followUpOf === undefined ? {} : { followUpOf })
          })
          await assignOwner(peer?.self.teammateId, mission.missionId)
          await rememberRoute(peer?.self.teammateId, { runtime: 'antigravity', model: mission.model, mode })
          return { ok: true, data: antigravityStartData(mission) } as const
        } catch (error) {
          if (error instanceof PeerRecordError) {
            return { ok: false, error: { code: 'PERSISTENCE_FAILED', message: error.message } } as const
          }
          return {
            ok: false,
            error: {
              code: error instanceof AntigravityStartError ? 'RUNTIME_START_FAILED' : 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : 'Antigravity could not start the mission.'
            }
          } as const
        }
      }
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
        if (peer?.worktreeRefused !== undefined) {
          return { ok: false, error: { code: 'RUNTIME_START_FAILED', message: peer.worktreeRefused } } as const
        }
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
        if (peer?.worktreeRefused !== undefined) {
          return { ok: false, error: { code: 'RUNTIME_START_FAILED', message: peer.worktreeRefused } } as const
        }
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
      if (appServerMissions.cancel(runId) || antigravityMissions.cancel(runId)) {
        return { ok: true, data: { runId, state: 'cancellation-requested' } } as const
      }
      return viaExec
    })

    ipcMain.handle(MISSION_RESUME_CHANNEL, async (event, request: unknown) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'The resume request was rejected.' }
        } as const
      }
      const refusedResume = noWorkspaceRefusal()
      if (refusedResume !== undefined) return refusedResume
      const payload = (typeof request === 'object' && request !== null ? request : {}) as Partial<MissionResumeRequest>
      // Same widening as a start and a handoff: an unrecognized mode is
      // read-only and an unrecognized runtime is Codex, so a malformed
      // request cannot buy itself write access by being wrong.
      const mode = payload.mode === 'accept-edits' ? 'accept-edits' : 'ask'
      const runtime = isMissionRuntime(payload.runtime) ? payload.runtime : 'codex'
      const model = typeof payload.model === 'string' ? payload.model : undefined
      const effort = typeof payload.effort === 'string' ? payload.effort : undefined
      try {
        return await codexMissions.resume(
          payload.missionId,
          runtime,
          mode,
          { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) },
          (update: CodexMissionUpdate) => {
            if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
              owner.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
            }
          }
        )
      } catch {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'The mission could not be resumed.' }
        } as const
      }
    })

    ipcMain.handle(MISSION_HANDOFF_CHANNEL, async (event, request: unknown) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner || !event.senderFrame || event.senderFrame.parent !== null) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'The handoff request was rejected.' }
        } as const
      }
      const refusedHandoff = noWorkspaceRefusal()
      if (refusedHandoff !== undefined) return refusedHandoff
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
          const ownerId = owners[response.data.continuesFrom.missionId]
          await assignOwner(ownerId, response.data.missionId)
          // A person picked this route for this teammate, mid-run; that is
          // as much a choice as starting them on it. The sidebar read the old
          // route while the composer read the new one (seen driving, 2026-09-05).
          await rememberRoute(ownerId, { runtime, model: model ?? 'account-default', mode })
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

/**
 * What to do instead of the final `app.quit()`, when something asked for the
 * quit in order to do it. Today that is the updater: an installer can only be
 * launched once the ledger is safely on disk.
 */
let quitFinaliser: (() => void) | undefined
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
      // Whoever asked for the quit gets the last word: the updater installs
      // and starts the app again. Anything else is an ordinary quit.
      const finalise = quitFinaliser
      quitFinaliser = undefined
      if (finalise !== undefined) finalise()
      else app.quit()
    })().catch((error: unknown) => {
      console.error('Failed to flush the local mission ledger during shutdown', error)
      app.exit(1)
    })
  })
}
