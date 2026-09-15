import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from './window-size.js'
import { APP_USER_MODEL_ID, DEVELOPMENT_APP_USER_MODEL_ID, sweepStaleElectronShortcuts } from './stale-shortcut.js'
import { openingPlacement, readSavedWindow } from './window-bounds.js'
import type { SavedWindow } from './window-bounds.js'
import { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, Notification, screen, session, shell } from 'electron'
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
import { appendFileSync, mkdirSync, readFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { release } from 'node:os'
import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexMissionService } from './codex-mission.js'
import { createApprovalChannel } from './approval-channel.js'
import { PeerRecordError } from './peer-exchange.js'
import { readNpmBinDirectory } from './npm-prefix.js'
import { createModelCatalog } from './model-catalog.js'
import { describeGone, diagnosticLine, shouldRoll, startupDetail } from './diagnostics.js'
import { readRuntimeArtifacts } from './runtime-artifacts.js'
import { relative } from 'node:path'
import { decideReveal } from './reveal-file.js'
import { MAX_ATTACHMENTS } from '../shared/attachments.js'
import { ATTACHMENT_DIR, attachmentDestination, excludeWith } from './attach-outside.js'
import { imageMediaType, MAX_PREVIEW_BYTES } from '../shared/image-files.js'
import { createTeammateStore } from './teammate-store.js'
import { createRoutineStore } from './routine-store.js'
import { createRoomStore } from './room-store.js'
import { createRoomTasks } from './room-tasks.js'
import type { RoomTasks } from './room-tasks.js'
import { rowToClaimAtStart, taskSection } from '../shared/room-task.js'
import { createRoutineRunner } from './routine-runner.js'
import { createMemoryStore } from './memory-store.js'
import { createWorktreeManager } from './worktrees.js'
import { readRuntimeSetup } from './runtime-setup.js'
import { briefSection, readWorkspaceBrief, worktreeSection } from './workspace-brief.js'
import { createMemoryReader } from './memory-reader.js'
import { createAttentionReader } from './attention-reader.js'
import { parseDecision } from '../shared/decision.js'
import { createTranscriptTracker } from './peer-exchange.js'
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
import type { MissionPeerContext } from './workroom-briefing.js'
import { createConnectorReader } from './connector-reader.js'
import { createRelay } from './relay.js'
import { createAttention } from './attention.js'
import { boundedShutdown } from './bounded-shutdown.js'
import { createPermissionHost } from './permission-host.js'
import { isInsideDirectory, readRememberedWorkspace, resolveWorkspacePath, WORKSPACE_ARGUMENT, writeRememberedWorkspace, workspaceIdFor } from './workspace.js'
import { createAntigravityHostProbe } from './antigravity-host.js'
import { AntigravityStartError, createAntigravityMissionService } from './antigravity-mission.js'
import type { Relay } from './relay.js'
import { createRuntimeDiscoveryService, RUNTIME_DISCOVERY_CHANNEL } from './runtime-discovery.js'
import { bootOutcome, createDiscoveryLog } from './discovery-log.js'
import { createRuntimeInstaller } from './runtime-installer.js'
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
  RUNTIME_ARTIFACTS_CHANNEL,
  RUNTIME_INSTALL_CHANNEL,
  RUNTIME_INSTALL_PROGRESS_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  TEAMMATE_RENAME_MISSION_CHANNEL,
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
  CONNECTOR_LIST_CHANNEL,
  TEAMMATE_CONNECTORS_CHANNEL,
  TEAMMATE_FOLDER_CHANNEL,
  WORKSPACE_CHOOSE_CHANNEL,
  WORKSPACE_ATTACH_CHANNEL,
  WORKSPACE_PASTE_CHANNEL,
  WORKSPACE_IMAGE_CHANNEL,
  WORKSPACE_REVEAL_CHANNEL,
  DIAGNOSTICS_REVEAL_CHANNEL,
  DIAGNOSTICS_REPORT_CHANNEL,
  OPEN_LINK_CHANNEL,
  DEFAULT_RELAY_HOP_CAP,
  DEFAULT_MEMORY_MODE,
  ROOM_LIST_CHANNEL,
  ROOM_CREATE_CHANNEL,
  ROOM_REMOVE_CHANNEL,
  ROOM_RENAME_CHANNEL,
  ROOM_POST_CHANNEL,
  RUNTIME_DISCOVERY_EVENT_CHANNEL,
  RUNTIME_DISCOVERY_LOG_CHANNEL,
  SPLASH_DONE_CHANNEL,
  ROOM_TASK_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL,
  TEAMMATE_UPDATE_CHANNEL
} from '../shared/ipc.js'
import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { isMissionRuntime, runtimeDisplayName } from '../shared/runtimes.js'
import { routeAtStart } from '../shared/route-at-start.js'
import { roleLabelOf } from '../shared/ipc.js'
import { isOutboundLink, isWebLink } from '../shared/outbound-links.js'
import { cursorReadyConnectors } from './cursor-connector-notice.js'
import { pruneMissionRecords, readStorageReport } from './retention.js'
import { createUpdateService } from './updates.js'
import type {
  CodexMissionCancelRequest,
  DiscoveryEvent,
  CodexMissionStartData,
  CodexMissionStartRequest,
  CodexMissionUpdate,
  MissionMode,
  PublicRoom,
  RoomPost,
  PublicTeammate,
  MissionApprovalRequest,
  MissionHandoffRequest,
  MissionResumeRequest
} from '../shared/ipc.js'
import { ROUTINE_RECOVERY_CHANNEL } from '../shared/routine-recovery.js'
import { decideRoutineRecovery } from './routine-recovery-ipc.js'

/**
 * How large a single paste may be.
 *
 * It crosses IPC in one message, so this is a bound on what the renderer can
 * hand the host at once. Generous for a screenshot -- a full 4K PNG is well
 * under it -- and short of anything that would stall a window. Bigger things
 * still go through the + button, which streams from a path rather than
 * carrying bytes.
 */
const MAX_PASTED_BYTES = 24 * 1024 * 1024

const probeRunner = createNodeProbeRunner()
// `LOCUST_HIDE_RUNTIMES=1` is a test seam: the first-run drive needs a
// machine with nothing installed, and this one has everything.
/*
 * npm's REAL prefix, asked once, so a runtime installed into a moved one is
 * findable.
 *
 * The locator's install-root table names npm's default prefix; a machine that
 * has run `npm config set prefix` -- corporate Windows, any nvm-style manager,
 * or anyone who followed the remedy LOCUST ITSELF prints on an EACCES failure
 * -- puts its shims somewhere else entirely. Discovery then reports "not
 * installed" for something the person has just installed, which is the worst
 * possible answer because it sends them to install it again.
 *
 * Resolved before the locator is built and passed in, so the search order
 * stays PATH first. A machine with no npm answers undefined and nothing
 * changes. See `npm-prefix.ts`.
 */
const npmBinDirectory = await readNpmBinDirectory()
const executableLocator = process.env.LOCUST_HIDE_RUNTIMES === '1'
  ? { find: async () => undefined }
  : createPathExecutableLocator(npmBinDirectory === undefined ? {} : { npmBinDirectory })
// Antigravity has no CLI probe: its readiness is whether the app is open,
// which the host checks itself and merges into the same sweep.
const antigravityProbe = createAntigravityHostProbe()
const discoverRuntimes = async (): Promise<readonly RuntimeDiscovery[]> => {
  const [found, antigravity] = await Promise.all([
    discoverInstalledRuntimes({
      runner: probeRunner,
      locator: executableLocator,
      includeOmniRoute: true,
      /*
       * A beat between starts you can actually SEE.
       *
       * 140ms put all six rows on screen inside 700ms -- less time than the
       * window itself takes to appear, so the log was complete before
       * anybody could watch it happen. Colin, with a photo taken at open:
       * "would be cool if we actually saw the terminal pop all those up."
       *
       * The stagger delays each probe's START, never its finish, and they
       * overlap: the only cost is the last row beginning about a second
       * later than it otherwise would, against probes that take seconds
       * anyway. That second is the thing this screen exists to fill.
       */
      staggerMs: 240,
      /*
       * `started` reaches the window BEFORE the subprocess is spawned --
       * that is the whole contract. A screen told about the start and the
       * result at the same moment has nothing to draw during the wait, and
       * the wait is the only thing it exists for.
       */
      watch: {
        started: (runtime) => {
          discoveryLog.emit({
            kind: 'probe.started',
            id: runtime.id,
            bin: runtime.bin,
            product: runtime.displayName,
            at: Date.now()
          })
        },
        finished: (runtime, discovery) => {
          const installed = discovery.availability === 'available'
          discoveryLog.emit({
            kind: 'probe.finished',
            id: runtime.id,
            at: Date.now(),
            outcome: bootOutcome({
              installed,
              status: discovery.readiness === 'ready'
                ? 'ready'
                : discovery.readiness === 'authentication-required'
                  ? 'auth-required'
                  : 'other'
            }),
            ...(discovery.version?.version === undefined ? {} : { version: discovery.version.version })
          })
        }
      }
    }),
    /*
     * Antigravity, announced like everything else.
     *
     * Its readiness is whether the app is open, so it is checked by the host
     * rather than by a CLI probe -- and being outside the swept definitions
     * meant it emitted no events at all. It then appeared in the settled
     * table having never been in the log above it, while Gemini was in the
     * log and not the table (Colin, 2026-09-14). One list, or the two
     * disagree in front of somebody.
     */
    (async () => {
      discoveryLog.emit({
        kind: 'probe.started',
        id: 'antigravity',
        bin: 'antigravity',
        product: 'Antigravity',
        at: Date.now()
      })
      const record = await antigravityProbe.discoveryRecord().catch(() => undefined)
      discoveryLog.emit({
        kind: 'probe.finished',
        id: 'antigravity',
        at: Date.now(),
        outcome: record === undefined
          ? 'missing'
          : bootOutcome({
              installed: record.availability === 'available',
              status: record.readiness === 'ready' ? 'ready' : record.readiness === 'authentication-required' ? 'auth-required' : 'other'
            }),
        ...(record?.version?.version === undefined ? {} : { version: record.version.version })
      })
      return record
    })()
  ])
  return antigravity === undefined ? found : [...found, antigravity]
}
/**
 * The connectors this machine has, read in the background and held.
 *
 * Colin, 2026-09-10: "honestly just let them have access to the mcp tools if
 * the client have access to it -- it only makes sense and is way less muddy."
 * So there is no per-teammate grant: what the person's Claude Code can reach,
 * their teammates can reach.
 *
 * The names are needed because an allow rule must NAME its server -- `mcp__*`
 * is refused outright -- and the account connectors from claude.ai never
 * appear in `~/.claude.json`, so they cannot be read off disk at all.
 * `claude mcp list` is the only source that has all of them, and it is slow
 * because it health-checks each one, so nothing ever waits for it.
 */
const connectorReader = createConnectorReader({
  read: async (timeoutMs) => {
    const claude = await executableLocator.find('claude').catch(() => undefined)
    if (claude === undefined) return undefined
    const result = await probeRunner.run({
      purpose: 'capabilities',
      executablePath: claude.executablePath,
      args: [...claude.prefixArgs, 'mcp', 'list'],
      timeoutMs
    })
    // The listing prints on stdout; a machine with none says so there too.
    // Both streams are joined because a warning on stderr has never been a
    // reason to throw the list away.
    if (result.timedOut === true) return undefined
    return `${result.stdout}
${result.stderr}`
  }
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
  /*
   * The sweep announces itself, one probe at a time.
   *
   * Emitted from the ONE place a real sweep happens, so the boot screen can
   * never show a sweep that did not occur, and a cached answer emits nothing
   * -- there is no wait to narrate.
   */
  const running = (async () => {
    await Promise.race([
      waitingForWindow,
      new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_CAP_MS))
    ])
    discoveryLog.emit({ kind: 'started', at: Date.now() })
    return discoverRuntimes()
  })()
    .then((value) => {
      discoveryCache = { at: Date.now(), value }
      const ready = value.filter((runtime) => runtime.readiness === 'ready').length
      const needsYou = value.filter((runtime) => runtime.readiness === 'authentication-required').length
      discoveryLog.emit({ kind: 'finished', at: Date.now(), ready, needsYou })
      return value
    })
    .finally(() => {
      discoveryInFlight = undefined
    })
  discoveryInFlight = running
  return running
}

/**
 * Can npm be run from here?
 *
 * Asked once and remembered: it is a fact about the machine, and asking on
 * every discovery sweep would spawn a child process every ten seconds for an
 * answer that changes when someone installs Node, not between ticks. The
 * remembered answer is dropped whenever an install finishes, which is the one
 * moment it can have changed under us.
 */
let npmSeen: boolean | undefined
const npmPresent = async (): Promise<boolean> => {
  if (npmSeen !== undefined) return npmSeen
  npmSeen = await new Promise<boolean>((resolve) => {
    // `shell: true` because Windows will not spawn npm.cmd otherwise, and
    // `--version` because it is the cheapest thing npm will answer.
    const probe = spawn('npm', ['--version'], { shell: true, windowsHide: true })
    const settle = (found: boolean): void => resolve(found)
    probe.on('error', () => settle(false))
    probe.on('close', (code) => settle(code === 0))
  })
  return npmSeen
}

/** Recorded and replayed, so a window created mid-sweep sees the whole log. */
const discoveryLog = createDiscoveryLog()

/*
 * THE FIRST SWEEP WAITS FOR SOMEBODY TO WATCH IT.
 *
 * Something in startup asked for the runtimes about three seconds before
 * the window appeared, so by the time a person could see the boot screen
 * the whole log had already happened and simply arrived at once. Colin,
 * 2026-09-14, with a photo taken a second after launch: "the majority of
 * the text is already appeared on the screen by the time the user opens it
 * so they dont see the whole terminal effect."
 *
 * It is also just wrong on its own terms: six subprocesses should not be
 * spawned before there is a window. Nothing needs the runtimes until
 * something is on screen asking about them.
 *
 * Capped, because a wait with no bound is a hang: a build that never opens
 * a window -- a smoke, a headless drive -- goes ahead after the cap rather
 * than stalling forever.
 */
const WINDOW_WAIT_CAP_MS = 3_000
let windowIsUp: () => void = () => undefined
const waitingForWindow = new Promise<void>((resolve) => {
  windowIsUp = resolve
})

const runtimeDiscovery = createRuntimeDiscoveryService({
  probe: discoverForWork,
  npmPresent
})
const ownsSingleInstanceLock = app.requestSingleInstanceLock()
let missionServiceForShutdown: CodexMissionService | undefined
let ledgerForShutdown: MissionLedger | undefined
let workroomForShutdown: Workroom | undefined
let permissionHostForShutdown: { dispose(): Promise<void> } | undefined

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

/*
 * THE LOADING WINDOW.
 *
 * Its own window, shown before the app, closing when the runtimes have
 * answered -- the ordinary shape of an application splash, and what Colin
 * asked for twice (2026-09-14): "have just that monitor screen be the
 * loading screen and once its done, THEN go to our app with its normal
 * splash with all runtimes should be connected."
 *
 * The design handoff argued for the opposite -- the pane, never a
 * full-window takeover -- on the grounds that a takeover "would hide
 * answers to show a decoration". That reasoning was about a relaunch with
 * the app already on screen. Here the app window does not exist yet, so
 * there is nothing being hidden: the cost is honestly a wait before the
 * workspace, which is what a loading screen IS.
 *
 * Sized to the tube, frameless, and never resizable: it is a picture of a
 * monitor, and a monitor you can drag the corner of is a window pretending
 * to be one.
 */
/** Ready but not shown, waiting for the loading window to finish. */
let appWindowWaiting: BrowserWindow | undefined

/** Show the app, whatever became of the splash. Safe to call twice. */
const showAppWindow = (): void => {
  const waiting = appWindowWaiting
  appWindowWaiting = undefined
  if (waiting === undefined || waiting.isDestroyed()) return
  /*
   * Restored, shown and focused, in that order.
   *
   * `show()` alone left the app "opened minimized" (Colin, 2026-09-14): a
   * window held unshown while another window had focus does not
   * necessarily come forward when it is finally shown, and on Windows it
   * can land minimised behind whatever the person was last looking at.
   */
  if (waiting.isMinimized()) waiting.restore()
  if (!waiting.isVisible()) waiting.show()
  waiting.focus()
}

/** How long the loading window may hold the app before it is opened anyway. */
const SPLASH_CAP_MS = 12_000
const SPLASH_WIDTH = 788
const SPLASH_HEIGHT = 568
let splashWindow: BrowserWindow | undefined

const createSplashWindow = (): BrowserWindow => {
  const splash = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    center: true,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: false,
    /*
     * TRANSPARENT, so the monitor is the only thing on screen.
     *
     * A window with its own ground drew a black slab behind the bezel and
     * around its rounded corners -- Colin, 2026-09-14: "remove the weird
     * black border behind it, just keep our natural border". The bezel
     * already has an edge and a radius of its own; the window should add
     * nothing to it.
     */
    transparent: true,
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
  splash.once('ready-to-show', () => {
    // Shown AND raised. A loading screen that opens behind the window that
    // had focus is a loading screen nobody sees.
    splash.show()
    splash.focus()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void splash.loadURL(`${process.env.ELECTRON_RENDERER_URL}#splash`)
  } else {
    void splash.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'splash' })
  }
  return splash
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
    /*
     * HELD until the loading window says it is done.
     *
     * Built, laid out and ready -- just not shown. So when the splash
     * closes, the workspace is already there with its runtimes answered
     * rather than assembling itself in front of somebody.
     *
     * If there is no splash (the preference is off, or it failed to open),
     * this shows at once, which is exactly what it did before.
     */
    if (splashWindow === undefined || splashWindow.isDestroyed()) window.show()
    else appWindowWaiting = window

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
    // macOS does not quit when the last window closes, and a run whose window
    // is gone can no longer be answered: an approval reaches nobody, so the
    // run cannot finish, cannot be stopped, and pins a ledger record that then
    // refuses to be deleted. This used to need a second call because the
    // approval transport was a service of its own; every mode runs here now,
    // and `interrupt` aborts each live run -- which kills its app-server
    // process -- while `clearActive` refuses whatever it was still asking.
    codexMissions.interrupt()
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

/**
 * Append one line, rolling the file first if it has grown past its cap.
 *
 * Every failure in here is swallowed on purpose. This runs while something
 * is already going wrong, and a diagnostics file that throws on its way to
 * recording a crash would replace a report with a second crash.
 */
const note = (label: string, detail: string): void => {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const path = errorLog()
    let bytes: number | undefined
    try {
      bytes = statSync(path).size
    } catch {
      // No file yet, or it cannot be measured. Either way, do not roll.
    }
    if (shouldRoll(bytes)) {
      // One generation. `renameSync` over an existing `.1` replaces it, so
      // the oldest is dropped rather than accumulating for ever.
      try {
        renameSync(path, path + '.1')
      } catch {
        // Could not roll -- appending to an oversized log still beats
        // losing the line.
      }
    }
    appendFileSync(path, diagnosticLine(new Date(), label, detail), 'utf8')
  } catch {
    // Nowhere to write at all.
  }
}

let toldAboutTrouble = false
const noteTrouble = (label: string, error: unknown): void => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  note(label, detail)
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

/*
 * THE CRASHES THE TWO LINES ABOVE CANNOT SEE.
 *
 * A renderer crash does NOT raise `uncaughtException` in the main process.
 * The window goes blank or disappears and main carries on healthy with
 * nothing to report -- so the single most recognisable way for this app to
 * break, the one a beta tester would describe as "Locust vanished", was the
 * one failure that wrote no line at all.
 *
 * These are `app`-level and so cover every window, including the loading
 * screen, without either of them having to know about this.
 */
app.on('render-process-gone', (_event, _contents, details) => {
  // `clean-exit` is a window being closed on purpose; it is not trouble and
  // a log full of it is a log nobody reads.
  if (details.reason === 'clean-exit') return
  note('render-process-gone', describeGone(details))
})
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return
  note('child-process-gone', `${details.type} ${describeGone(details)}${details.name === undefined ? '' : ` name=${details.name}`}`)
})

/*
 * A window that stops answering is not dead and gets no dialog: it usually
 * comes back, and Windows draws its own "not responding" on the frame. It IS
 * worth a line, because "it froze for a bit" is otherwise unanswerable.
 */
app.on('web-contents-created', (_event, contents) => {
  contents.on('unresponsive', () => note('unresponsive', 'a window stopped answering'))
  contents.on('responsive', () => note('responsive', 'it started answering again'))
})

/*
 * Native crash dumps, kept on this machine.
 *
 * `uploadToServer: false` is not a default being restated -- it is a promise
 * the app already makes on screen. Settings says "Every mission is recorded
 * to an append-only ledger on this machine. Nothing is uploaded." A crash
 * reporter that phoned home would make that sentence false.
 *
 * Started before `whenReady` because a crash during startup is exactly the
 * one worth catching, and it must be running before there is anything to
 * crash.
 */
crashReporter.start({ uploadToServer: false })


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
    /*
     * The first line of every run.
     *
     * A log that reaches us with no version in it can only be answered with
     * a question, and by the time we ask, the person has usually updated.
     */
    note('start', startupDetail({
      version: app.getVersion(),
      platform: process.platform,
      release: release(),
      electron: process.versions.electron ?? 'unknown',
      packaged: app.isPackaged
    }))
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

    // Named once, because two things need it: the ledger itself, and the
    // reveal root that lets someone open the folder when a write to it fails.
    // A person told "Locust cannot write its ledger" and given no way to go
    // and look at the folder has been informed and not helped.
    const ledgerDirectory = join(app.getPath('userData'), 'mission-ledger')
    const missionLedger = createFileMissionLedger({ rootDirectory: ledgerDirectory })
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
        // And it is told so even when there is no LOCUST.md.
        //
        // 0.36.4 fixed worktree runs dying on a directory refusal partly with
        // one sentence -- "you have your own copy, work only inside the
        // folder you were started in" -- which lives inside the brief above
        // and is therefore sent ONLY when the folder happens to have a
        // LOCUST.md in it. The nine clean runs that measured the fix were
        // driven on `scratchRepository`, which writes one. A default install
        // does not have one, so the fix did not reach the person it was for
        // (QA, 2026-09-06). It is its own line now, because it is a fact
        // about where the run is, not about the project's instructions.
        if (peer.cwd !== undefined && brief === undefined) {
          sections.push(worktreeSection())
        }
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
          // Undefined for a worktree teammate, for the same reason the brief
          // above stopped naming it: memory's own line said "what is
          // remembered for the folder <parent>", which names the folder the
          // run is NOT standing in -- the exact invitation 0.36.4 removed
          // from the other section and left here (QA, 2026-09-06). Memory is
          // the project's either way; only the pointer at a folder goes.
          workspaceName: peer.cwd === undefined ? memoryWorkspaceName : undefined,
          memories: listed.map((memory) => ({
            text: memory.text,
            scope: memory.scope,
            by: memory.by.name,
            where: memory.scope === 'global' && memory.workspaceId !== memoryWorkspaceId ? memory.workspaceName : undefined,
            // So a teammate can tell a note from this morning from one that
            // has been sitting there since August.
            at: memory.createdAt
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
    /**
     * Raise the approval card, and tell the OS by name if the person is
     * looking elsewhere. Shared: Codex's app-server approvals and Claude
     * Code's permission host are the same card, answered the same way.
     */
    const raiseApproval = (request: MissionApprovalRequest): void => {
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
      }

    /*
     * Locust as Claude Code's permission host. See permission-host.ts for
     * what was measured. The bridge script ships BESIDE app.asar, because
     * Claude Code spawns it as a process and cannot spawn a path inside
     * an archive -- the same reason the window icon lives there.
     */
    const permissionHost = createPermissionHost({
      bridgePath: app.isPackaged
        ? join(process.resourcesPath, 'locust-permission-bridge.mjs')
        : join(__dirname, '../../resources/locust-permission-bridge.mjs'),
      // Electron's own binary, run as node (ELECTRON_RUN_AS_NODE is set in
      // the server's env): guaranteed present, whatever is on PATH.
      node: process.execPath,
      emitApproval: raiseApproval
    })
    permissionHostForShutdown = permissionHost

    /*
     * What answers a run that stops to ask. Approve-each used to have a whole
     * second mission service for this; since every Codex mode runs on
     * app-server through the one loop, the channel is all that mode still
     * needs of its own.
     */
    const approvals = createApprovalChannel({
      emitApproval: raiseApproval,
      emitUpdate: (update) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
        }
      }
    })

    const codexMissions = createCodexMissionService({
      workspacePath,
      permissionHost,
      approvals,
      // Every Codex mode rides `codex app-server`, because `codex exec --json`
      // never streams an agent message -- measured 2026-09-10, the whole reply
      // arrives as one `item.completed`. Called lazily for the same reason
      // `liveElsewhere` is: the spawner is defined further down this same
      // setup, and nothing starts a mission until all of it has run.
      appServerSpawn: (executablePath, args) => spawnAppServer(executablePath, args),
      /*
       * Asked at the start of every run, never captured: a connector signed
       * into after launch reaches the next mission without a restart.
       *
       * The refresh is kicked and NOT awaited. `claude mcp list` health-checks
       * every server, so awaiting it would put seconds between pressing send
       * and anything happening. The reading it takes lands for the next run;
       * this one uses whatever is already held, which after the warm below is
       * almost always the current list.
       */
      connectors: () => {
        void connectorReader.refresh().catch(() => undefined)
        return connectorReader.names()
      },
      /*
       * The cap is ONE pool across all three transports.
       *
       * Each service counted only its own live runs, so four exec runs, four
       * approve-each runs and four Antigravity runs could be live together --
       * twelve -- while the refusal still read \"up to 4\" and every read in
       * this file already summed all three (teammateBusy, the sidebar count,
       * the busy list). Reported as one number, enforced as three.
       *
       * Read lazily rather than captured, because these three are constructed
       * in sequence and each needs the other two.
       */
      liveElsewhere: () => antigravityMissions.liveMissionIds().length,
      // Asked at the moment a run starts, never cached: switching Auto off in
      // Settings has to reach the next run, including one a relay or a saved
      // routine is about to start.
      autoModeAllowed: async () => (await teammates.readSettings()).autoMode === true,
      // Same shape, same reason: read when the run starts, so flipping the
      // switch reaches the next mission without a restart.
      askConnectors: async () => (await teammates.readSettings()).askConnectors === true,
      keepATodoList: async () => (await teammates.readSettings()).keepATodoList === true,
      readyConnectors: cursorReadyConnectors,
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
      // One pool -- see the note on codexMissions above.
      liveElsewhere: () => codexMissions.liveMissionIds().length,
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

    /*
     * Discovery, pushed to the window as it happens.
     *
     * Everything already recorded goes first, because the window is created
     * while the first sweep is running and a screen that joined halfway
     * would be missing the beginning of its own log.
     */
    /*
     * To EVERY window, not just the app's.
     *
     * This sent only to `approvalWindow`, and the loading window is a
     * second window -- so the splash pulled the backlog once and then never
     * heard another word, which meant it never saw discovery finish and
     * never closed. The app sat behind it, built and invisible.
     *
     * Discovery is a fact about the machine, not about one window, so every
     * window that is open gets it.
     */
    const sendDiscovery = (event: DiscoveryEvent): void => {
      for (const target of BrowserWindow.getAllWindows()) {
        if (!target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(RUNTIME_DISCOVERY_EVENT_CHANNEL, event)
        }
      }
    }
    discoveryLog.subscribe(sendDiscovery)
    /*
     * REPLAY WHEN THERE IS A WINDOW, not when this line runs.
     *
     * `approvalWindow` is assigned at the end of startup, so everything
     * emitted before then -- `context` among it, which is emitted once per
     * launch -- reached a `sendDiscovery` with nowhere to send. Measured on
     * the first drive: the screen opened at "scanning PATH" with no
     * preamble above it, because the three lines above it had already been
     * spoken to an empty room.
     */
    const replayDiscoveryToWindow = (): void => {
      for (const event of discoveryLog.replay()) sendDiscovery(event)
    }
    // And the renderer can ask, which is what actually works: a replay sent
    // at window creation lands before the page has mounted a listener.
    ipcMain.handle(RUNTIME_DISCOVERY_LOG_CHANNEL, () => discoveryLog.replay())
    /*
     * The loading window is finished: show the app and close the splash, in
     * that order. Closing first would leave an empty desktop for a frame.
     */
    ipcMain.on(SPLASH_DONE_CHANNEL, () => {
      showAppWindow()
      const splash = splashWindow
      splashWindow = undefined
      if (splash !== undefined && !splash.isDestroyed()) splash.close()
    })

    /*
     * What this launch is, said once and only while somebody is waiting.
     *
     * Every value here is read, never composed for the screen: the version
     * the app reports, the platform it is on, the folder it opened, the
     * branch that folder is on, and whether the ledger directory can
     * actually be written to. `ledgerOk` is a real write test rather than a
     * guess, because "your ledger is fine" is exactly the kind of
     * reassurance that must not be invented.
     */
    void (async () => {
      const readGit = (args: readonly string[]): Promise<string | undefined> =>
        new Promise((resolve) => {
          execFile('git', [...args], { cwd: workspacePath, windowsHide: true }, (error, stdout) => {
            resolve(error === null ? stdout.trim() : undefined)
          })
        })
      const branch = await readGit(['rev-parse', '--abbrev-ref', 'HEAD'])
      const dirty = await readGit(['status', '--porcelain'])
      // A real write test, not a guess. "Your ledger is fine" is exactly the
      // kind of reassurance that must not be invented.
      let ledgerOk = false
      try {
        await mkdir(ledgerDirectory, { recursive: true })
        await writeFile(join(ledgerDirectory, '.writable'), '', 'utf8')
        ledgerOk = true
      } catch {
        ledgerOk = false
      }
      discoveryLog.emit({
        kind: 'context',
        version: app.getVersion(),
        platform: `${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} ${release()}`,
        workspace: workspaceChosen ? basename(workspacePath) || workspacePath : 'no folder',
        ...(branch === undefined || branch.length === 0 || branch === 'HEAD' ? {} : { branch }),
        ...(dirty === undefined ? {} : { clean: dirty.length === 0 }),
        ledgerPath: ledgerDirectory,
        ledgerOk
      })
    })()

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

    // Installing is its own service: one at a time, and it asks discovery
    // again after a clean exit rather than trusting npm's exit code alone.
    const runtimeInstaller = createRuntimeInstaller({
      nowInstalled: async (runtime) => {
        discoveryCache = undefined
        const found = await discoverForWork()
        return found.some((entry) => entry.id === runtime && entry.availability === 'available')
      }
    })

    const modelCatalog = createModelCatalog({
      discover: discoverForWork,
      spawn: spawnAppServer
    })


    /**
     * Install a runtime, streaming npm's output to the window that asked.
     *
     * The installer runs one at a time and refuses a second; the exact
     * command it spawns is the same string the screen showed, so the app
     * cannot display one thing and run another. After a clean exit the
     * discovery cache is dropped and the machine is asked again -- which is
     * how "npm said fine but there is still nothing to run" is DETECTED
     * rather than guessed at.
     */
    ipcMain.handle(RUNTIME_INSTALL_CHANNEL, async (event, runtime: unknown) => {
      if (!fromOwnWindow(event) || typeof runtime !== 'string') {
        return { ok: false, what: 'That runtime cannot be installed from here.', next: 'Use the command shown.' } as const
      }
      const target = BrowserWindow.fromWebContents(event.sender)
      // Whatever this install does, it may have been the thing that put npm
      // on the machine -- or proved it is not there.
      npmSeen = undefined
      return runtimeInstaller.install({
        runtime,
        onLine: ({ line }) => {
          if (target !== null && !target.isDestroyed()) {
            target.webContents.send(RUNTIME_INSTALL_PROGRESS_CHANNEL, { runtime, line })
          }
        }
      })
    })

    ipcMain.handle(MODEL_CATALOG_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'Models could not be read.' } } as const
      }
      return modelCatalog.read()
    })

    // What the person already set up inside the CLIs themselves. Read-only,
    // and gated on discovery: a leftover `.claude/agents` from an uninstall
    // must not read as a working teammate's routine.
    ipcMain.handle(RUNTIME_ARTIFACTS_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return []
      try {
        const runtimes = await discoverForWork()
        // Signed out still counts as installed: the agents they wrote are on
        // this machine whether or not the CLI can run right now.
        const installed = runtimes
          .filter(
            (runtime: RuntimeDiscovery) =>
              runtime.readiness === 'ready' || runtime.readiness === 'authentication-required'
          )
          .map((runtime: RuntimeDiscovery) => runtime.id)
        return await readRuntimeArtifacts({ installed })
      } catch {
        // A list nobody can read is an empty list, not a broken screen.
        return []
      }
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
      // Whichever host is holding this id. A Codex approval lives in the
      // mission service's approval channel; a Claude Code connector permission
      // lives in the permission host. An id is minted by exactly one of them.
      const decided = { approvalId: payload.approvalId, decision: normalized } as const
      return { ok: codexMissions.decide(decided) || permissionHost.decide(decided) } as const
    })

    const teammates = createTeammateStore({ rootDirectory: app.getPath('userData') })
    missionServiceForShutdown = codexMissions
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
      /*
       * Where this teammate stands.
       *
       * Three cases and they compose. A teammate with its own folder works
       * there, and its own-branch worktree is cut from THAT folder's
       * repository rather than the project's -- a worktree of a repository
       * the teammate is not in would put it somewhere nobody asked for.
       * With no folder of its own it is the project folder, as before.
       *
       * The folder is not checked for existence here. `ensure` says so for
       * a worktree, and a run started in a folder that is gone fails with
       * the runtime's own words, which name the path. A silent fallback to
       * the project folder would be worse: the mission would succeed in the
       * wrong place.
       */
      const home = self.folder
      if (home !== undefined) cwd = home
      let repositoryRoot: string | undefined
      // Antigravity works in the folder it has open; a worktree would be one it has not.
      if (self.worktree === true && self.route?.runtime !== 'antigravity') {
        const manager = home === undefined ? worktrees : createWorktreeManager({ workspacePath: home })
        if (manager !== undefined) {
          try {
            cwd = await manager.ensure(self)
            repositoryRoot = home ?? workspacePath
          } catch (error) {
            worktreeRefused = `${self.name} is set to work on its own branch, but ${error instanceof Error ? error.message : 'the worktree could not be made.'}`
          }
        }
      }
      return {
        self: entry(self),
        others: roster.filter((other) => other.teammateId !== teammateId).map(entry),
        ...(cwd === undefined ? {} : { cwd }),
        ...(repositoryRoot === undefined ? {} : { repositoryRoot }),
        ...(self.connectors === undefined ? {} : { connectors: self.connectors }),
        ...(worktreeRefused === undefined ? {} : { worktreeRefused })
      }
    }

    /**
     * Every folder a teammate has been pointed at, for the reveal allowlist.
     *
     * Read fresh rather than cached: a folder chosen a second ago has to be
     * openable, and an unreadable roster is an empty list rather than a
     * thrown reveal.
     */
    const teammateFolders = async (): Promise<readonly string[]> => {
      try {
        return (await teammates.list()).flatMap((teammate) => (teammate.folder === undefined ? [] : [teammate.folder]))
      } catch {
        return []
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
      // The one question a held reply has to ask before it starts: is there
      // still anything to show them? Whatever a teammate has not read rides
      // along on the next run whoever starts it, so a person who messaged
      // them in the meantime already delivered the message.
      stillWaiting: async (teammateId) => (await workroom.unread(teammateId, 1)).messages.length > 0,
      mayInterrupt: async () => (await teammates.readSettings()).interrupt === true,
      /*
       * Stop whatever this teammate is running, whichever transport owns it.
       *
       * Only ever stops. The waiting message is started by the relay's own
       * held-message path when the run ends, which is the path every other
       * waiting message takes -- so an interruption cannot become a second
       * way to start a mission, and the hop cap and the relay switch bound it
       * because it never goes near either.
       */
      /*
       * Write an ending into the mission's own record.
       *
       * A relay notice was a live update only, so a person watching another
       * conversation when an exchange stopped never learned it had, and
       * reopening the thread later showed nothing -- it simply appeared to
       * stop for no reason. The host already raises `host.*` diagnostics into
       * a mission this way (`host.shared_workspace`, disk-observation.ts);
       * this is the same shape.
       *
       * Appending AFTER a run's terminal event is safe: `phaseFor` scans
       * backwards for any terminal event, so a completed mission stays
       * completed. Checked before this was written rather than after.
       */
      note: async ({ missionId, message }) => {
        const mission = await missionLedger.getMission(missionId).catch(() => undefined)
        if (mission === undefined) return
        const last = mission.events.at(-1)
        // The ledger requires contiguous sequences, and this is the only
        // writer once a run is over -- so the recorded tail is the truth.
        const sequence = (last?.sequence ?? 0) + 1
        await missionLedger
          .appendEvents(missionId, [
            {
              id: `${mission.metadata.runId}:relay:${String(sequence)}`,
              runId: mission.metadata.runId,
              missionId,
              sequence,
              type: 'adapter.diagnostic',
              occurredAt: new Date().toISOString(),
              sourceAdapter: last?.sourceAdapter ?? mission.metadata.runtime,
              payload: {
                level: 'info',
                code: 'host.relay_ended',
                message,
                terminal: false,
                evidence: { redacted: true }
              }
            } as NormalizedRuntimeEvent
          ])
          .catch(() => undefined)
      },
      stopWorkOf: async (teammateId) => {
        const codexRun = codexMissions.runIdOwnedBy(teammateId)
        if (codexRun !== undefined) return codexMissions.cancel(codexRun).ok
        const antigravityRun = antigravityMissions.runIdOwnedBy(teammateId)
        if (antigravityRun !== undefined) return antigravityMissions.cancel(antigravityRun)
        return false
      },
      notify: sendToWindow
    })

    // Routines replay through the same start path a teammate's reply uses,
    // so a replayed step is a real mission on the teammate's own route, in
    // its own ledger, recorded as started by the routine.
    const routines = createRoutineStore({ rootDirectory: app.getPath('userData') })
    const rooms = createRoomStore({ rootDirectory: app.getPath('userData') })
    routineRunner = createRoutineRunner({
      workspaceId: memoryWorkspaceId,
      routines,
      peerContextFor,
      start: (input) =>
        codexMissions.start(
          input.prompt,
          input.runtime,
          input.mode,
          {
            ...(input.model === undefined ? {} : { model: input.model }),
            // A routine replays on a STORED route, which now carries the level
            // it was taught with. Without this one saved at `high` quietly
            // replayed at the runtime's default.
            ...(input.effort === undefined ? {} : { effort: input.effort })
          },
          sendToWindow,
          undefined,
          input.peer,
          input.followUpOf,
          undefined,
          input.startedBy
        ),
      assignOwner: (teammateId, missionId) => assignOwner(teammateId, missionId),
      phaseOf: async (missionId) => (await missionLedger.getMission(missionId))?.phase,
      // Whichever transport owns it. The ledger cannot say "still going" --
      // a mission with no terminal event reads as `interrupted` either way.
      isLive: (missionId) => codexMissions.hasMission(missionId) || antigravityMissions.hasMission(missionId),
      /*
       * Whether that turn ended by asking the person something.
       *
       * The same three steps `attention-reader.ts` already takes to decide it
       * has a decision to announce: recover the mission, rebuild the last
       * FINAL assistant message, look for a decision block. Reusing that path
       * rather than inventing a second one is the point -- two readers
       * disagreeing about whether a turn asked a question is how the card and
       * the routine would end up on different sides of one fact.
       */
      askedAQuestion: async (missionId) => {
        try {
          const recovered = await missionLedger.getMission(missionId)
          if (recovered === undefined) throw new Error('Routine mission receipt unavailable')
          const tracker = createTranscriptTracker()
          tracker.track(recovered.events)
          const text = tracker.latestFinal
          return text === undefined ? false : parseDecision(text) !== undefined
        } catch (error) {
          // Recovery must distinguish an unreadable answer from "no question".
          throw error
        }
      },
      // A scheduled routine waits for any live run of the teammate's, whoever started it.
      teammateBusy: async (teammateId) => {
        const owners = await teammates.missionOwners()
        const live = [...codexMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()]
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
    // Warmed here rather than at import: it spawns Claude Code, and doing
    // that before the window exists would put a health check in front of the
    // first paint.
    void connectorReader.refresh().catch(() => undefined)
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
      /*
       * Start one member who has been waiting for a slot.
       *
       * Same path the post itself uses, so a queued member is briefed with
       * the board as it stands NOW and runs on their own route -- they are
       * answering the same post, just later. The window is told the same
       * way the post tells it, or the run would be live with no row.
       *
       * `startRoomMember` is declared further down this scope; this closure
       * only reads it when a run ends, long after.
       */
      startQueued: async (room, postId, teammateId) => {
        const post = room.posts.find((entry) => entry.postId === postId)
        if (post === undefined) return 'refused'
        const attempt = await startRoomMember(room, teammateId, post.text, await teammates.list())
        if (!attempt.ok) return attempt.retryable ? 'no-slot' : 'refused'
        sendToWindow({
          kind: 'mission-started',
          runId: attempt.data.runId,
          missionId: attempt.data.missionId,
          teammateId,
          prompt: post.text,
          data: attempt.data,
          startedBy: { kind: 'room', roomId: room.roomId, postId }
        })
        return { missionId: attempt.data.missionId }
      },
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
      if (!fromOwnWindow(event)) return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false, askConnectors: false, keepATodoList: false, layout: 'auto', tube: 'full' } as const
      try {
        return await teammates.readSettings()
      } catch {
        // An unreadable switch reads as its default: swarm off, replies on.
        return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false, askConnectors: false, keepATodoList: false, layout: 'auto', tube: 'full' } as const
      }
    })

    /*
     * The folder ONE teammate works in.
     *
     * Deliberately not the folder switch above. That one reopens Locust,
     * because the ledger, the memory store and the worktrees are all scoped
     * by the project folder; this one moves nothing but where a single
     * teammate's next run stands, so nothing has to be rebound and nothing
     * closes. Colin, 2026-09-09: "it should only change the folder for that
     * chat/teammate not the entire app."
     *
     * The renderer names no path here either. It asks for a teammate; the
     * HOST opens the dialog, checks what came back, and writes it. Clearing
     * needs no dialog and takes the same route so there is one place that
     * decides what a teammate's folder may be.
     */
    /*
     * Every connector the person's Claude Code reports, for the teammate
     * dialog to offer. Refreshed on the way, because a person opening this
     * list has usually just connected something.
     */
    ipcMain.handle(CONNECTOR_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return { ok: false, error: { code: 'CONNECTORS_UNAVAILABLE', message: 'That request was rejected.' } } as const
      try {
        return { ok: true, data: { connectors: await connectorReader.refresh() } } as const
      } catch {
        return { ok: true, data: { connectors: connectorReader.current() } } as const
      }
    })

    /*
     * Narrow one teammate to some of them, or widen it back. The names come
     * from the list above, but the store reads them strictly either way: a
     * name is an allow rule on a real command line.
     */
    ipcMain.handle(TEAMMATE_CONNECTORS_CHANNEL, async (event, requested: unknown) => {
      if (!fromOwnWindow(event)) {
        return { ok: false, error: { code: 'REJECTED', message: 'The connector request was rejected.' } } as const
      }
      const ask = typeof requested === 'object' && requested !== null ? (requested as Record<string, unknown>) : {}
      try {
        return { ok: true, data: { teammate: await teammates.setConnectors(ask.teammateId, ask.names) } } as const
      } catch (error) {
        return {
          ok: false,
          error: { code: 'REJECTED', message: error instanceof Error ? error.message : 'That could not be changed.' }
        } as const
      }
    })

    ipcMain.handle(TEAMMATE_FOLDER_CHANNEL, async (event, requested: unknown) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (owner === null || !fromOwnWindow(event)) {
        return { ok: false, error: { code: 'REJECTED', message: 'The folder request was rejected.' } } as const
      }
      const ask = typeof requested === 'object' && requested !== null ? (requested as Record<string, unknown>) : {}
      const teammateId = typeof ask.teammateId === 'string' ? ask.teammateId : ''
      if (ask.clear === true) {
        try {
          return { ok: true, data: { teammate: await teammates.setFolder(teammateId, undefined) } } as const
        } catch (error) {
          return {
            ok: false,
            error: { code: 'REJECTED', message: error instanceof Error ? error.message : 'That could not be changed.' }
          } as const
        }
      }
      let known
      try {
        known = (await teammates.list()).find((teammate) => teammate.teammateId === teammateId)
      } catch {
        known = undefined
      }
      if (known === undefined) {
        return { ok: false, error: { code: 'REJECTED', message: 'That teammate is not on the roster.' } } as const
      }
      const picked = await dialog.showOpenDialog(owner, {
        title: `Choose the folder ${known.name} works in`,
        buttonLabel: 'Work here',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: known.folder ?? (workspaceChosen ? workspacePath : app.getPath('home'))
      })
      const next = picked.filePaths[0]
      if (picked.canceled || next === undefined) {
        return { ok: false, error: { code: 'CANCELLED', message: 'No folder chosen.' } } as const
      }
      // The same refusal the project folder gets: a teammate pointed at
      // Locust's own installation would be editing the app it is running in,
      // and an update would take its work with it.
      if (isInsideDirectory(next, installDirectory, process.platform)) {
        return {
          ok: false,
          error: { code: 'REJECTED', message: 'That is where Locust itself is installed. Pick a project folder instead.' }
        } as const
      }
      try {
        return { ok: true, data: { teammate: await teammates.setFolder(teammateId, next) } } as const
      } catch (error) {
        return {
          ok: false,
          error: { code: 'REJECTED', message: error instanceof Error ? error.message : 'That folder could not be saved.' }
        } as const
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
      // Long enough for "Reopening in <folder>" to be READ. At 150ms the
      // window vanished before the sentence explaining it could be seen, so
      // the honest restart was indistinguishable from a crash -- reported as
      // one twice (Colin, 2026-09-11).
      setTimeout(() => app.quit(), 900)
      return { ok: true, data: { path: next, reopening: true } } as const
    })

    /*
     * Open one of the addresses this app is allowed to open, and no other.
     *
     * The policy above still holds -- `window.open` is denied and navigation
     * away from the app's URL is cancelled -- and it asked that a feature
     * needing a link name the exact URL in the HOST. The first-run panel
     * grew three links and nobody did, so every "Get it" in every shipped
     * build was dead: it looked like a link, it had a cursor, and clicking
     * it did nothing at all. Found by the first outside tester on 0.55.0,
     * who had no Node.js and whose only offered way out was one of them.
     *
     * The renderer names a URL; the host opens it only if it is on the
     * host's own list, so a renderer turned against the person can still
     * reach nowhere else.
     */
    ipcMain.handle(OPEN_LINK_CHANNEL, async (event, requested: unknown) => {
      if (!fromOwnWindow(event)) return { ok: false, message: 'That request was rejected.' } as const
      /*
       * The app's own three addresses, OR a plain web address from a reply.
       *
       * The widening is real and is named here rather than buried: before
       * this, a renderer turned against the person could reach exactly three
       * hosts, and now it can reach any http(s) one. What has not changed is
       * that `shell.openExternal` opens the PERSON's browser, visibly, and
       * only ever because they clicked something. What is refused has not
       * changed either: every non-web scheme, which is what the original
       * policy was actually defending -- a reply must not become a way to
       * reach this machine. See `isWebLink`.
       */
      if (!isOutboundLink(requested) && !isWebLink(requested)) {
        return { ok: false, message: 'Locust does not open that address.' } as const
      }
      try {
        await shell.openExternal(requested)
        return { ok: true } as const
      } catch {
        return { ok: false, message: 'Your browser could not be opened.' } as const
      }
    })

    /*
     * Reveal, never open -- the same rule `reveal-file.ts` sets out. A log is
     * a text file and opening one is harmless, but the rule is worth keeping
     * whole: the app never hands a path to the operating system and asks it
     * to decide what running it means.
     *
     * The file is guaranteed to exist by the time anyone can press this,
     * because every run writes its opening line before a window is shown.
     */
    ipcMain.handle(DIAGNOSTICS_REVEAL_CHANNEL, () => {
      shell.showItemInFolder(errorLog())
    })
    ipcMain.handle(DIAGNOSTICS_REPORT_CHANNEL, () => {
      const path = errorLog()
      try {
        return { path, exists: true, byteTotal: statSync(path).size }
      } catch {
        return { path, exists: false, byteTotal: 0 }
      }
    })
    ipcMain.handle(WORKSPACE_REVEAL_CHANNEL, async (event, requested: unknown) => {
      if (!fromOwnWindow(event)) return { ok: false, message: 'That request was rejected.' } as const
      // The roots are the host's, never the renderer's. The workspace and
      // every worktree inside it, Locust's own ledger folder, and any folder
      // a teammate has been pointed at -- a file that teammate wrote is a
      // file this app showed you, and refusing to open it would be the app
      // disowning its own work. All of them are the HOST's paths; the
      // renderer still names nothing it was not already shown.
      const decision = decideReveal(requested, [
        ...(workspaceChosen ? [workspacePath] : []),
        ...(await teammateFolders()),
        ledgerDirectory
      ])
      if (!decision.ok) {
        return {
          ok: false,
          message:
            decision.reason === 'no-path'
              ? 'There is no file to show.'
              : 'That file is outside the folder your teammates work in, so Locust will not open it.'
        } as const
      }
      // Reveals, never opens: `showItemInFolder` puts a file manager in front
      // of the person. `openPath` would run a `.bat` or a `.ps1` that a model
      // wrote, which is not a click anyone should be one step away from.
      shell.showItemInFolder(decision.path)
      return { ok: true } as const
    })

    /*
     * An attached image, for the renderer to draw.
     *
     * The same containment as a reveal, and for the same reason: this reads
     * bytes off the disk and hands them to a web page, so the only paths it
     * will answer are ones inside the folder the teammates work in. A file
     * from outside was already copied in by the attach handler, so by the time
     * anything asks for a preview it IS inside -- there is nothing this needs
     * to reach that the picker did not already put there.
     *
     * Every refusal is quiet. The file row is drawn either way and already
     * carries the name; a preview is an extra, and an extra that fails should
     * leave no wreckage on screen.
     */
    ipcMain.handle(WORKSPACE_IMAGE_CHANNEL, async (event, requested: unknown) => {
      if (!fromOwnWindow(event)) return { ok: false, message: 'That request was rejected.' } as const
      if (typeof requested !== 'string' || requested.length === 0) {
        return { ok: false, message: 'No path.' } as const
      }
      if (workspacePath === undefined) return { ok: false, message: 'No workspace.' } as const
      const mediaType = imageMediaType(requested)
      if (mediaType === undefined) return { ok: false, message: 'Not an image this app draws.' } as const
      const decision = decideReveal(join(workspacePath, requested), [workspacePath])
      if (!decision.ok) return { ok: false, message: 'Outside the workspace.' } as const
      try {
        // Size is checked BEFORE reading, not after: the point of the cap is
        // to avoid holding a very large file in memory, and reading it first
        // to find out how big it is would have already done that.
        const measured = await stat(decision.path)
        if (!measured.isFile()) return { ok: false, message: 'Not a file.' } as const
        if (measured.size > MAX_PREVIEW_BYTES) {
          return { ok: false, message: 'Too large to preview.' } as const
        }
        const bytes = await readFile(decision.path)
        return { ok: true, dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` } as const
      } catch {
        return { ok: false, message: 'Could not be read.' } as const
      }
    })

    /*
     * Ctrl+V, which the picker cannot serve.
     *
     * Colin, 2026-09-10: "lets add the ability to ctrl+v a file or photo into
     * the chat." A pasted SCREENSHOT is the case that decides the shape --
     * the clipboard holds a bitmap, not a file, so there is no path anywhere
     * for the picker's route to take. The bytes come across and the host
     * writes them.
     *
     * The renderer suggests a name and the host does not trust it:
     * `attachmentDestination` already refuses anything that is not a plain
     * file name -- no separators, no colon, not `.` or `..` -- and always
     * returns a path inside the one folder Locust owns. So the worst a
     * renderer can do here is choose which name inside that folder it gets,
     * which is what a person choosing a file does anyway.
     */
    ipcMain.handle(WORKSPACE_PASTE_CHANNEL, async (event, requested: unknown) => {
      if (!fromOwnWindow(event)) return { ok: false, message: 'That request was rejected.' } as const
      if (!workspaceChosen) {
        return { ok: false, message: 'Choose the folder your teammates work in first.' } as const
      }
      const asked = typeof requested === 'object' && requested !== null ? (requested as Record<string, unknown>) : {}
      const bytes = asked.bytes
      const name = typeof asked.name === 'string' ? asked.name : ''
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        return { ok: false, message: 'There was nothing on the clipboard to attach.' } as const
      }
      // A bound, because this crosses IPC in one message and a clipboard can
      // hold something very large. Generous for a screenshot or a document,
      // and far short of anything that would stall the renderer.
      if (bytes.byteLength > MAX_PASTED_BYTES) {
        return {
          ok: false,
          message: 'That is too large to paste. Attach it with the + button instead.'
        } as const
      }
      try {
        const taken = new Set(await readAttachmentNames(workspacePath))
        const destination = attachmentDestination(name, taken)
        await mkdir(join(workspacePath, ATTACHMENT_DIR), { recursive: true })
        await writeFile(join(workspacePath, destination), bytes)
        await keepAttachmentsOutOfGit(workspacePath)
        // Copied in, like any file from outside: it never was in the folder,
        // and the tile says so for the same reason.
        return { ok: true, paths: [destination], copied: [destination] } as const
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'That could not be attached.'
        } as const
      }
    })

    ipcMain.handle(WORKSPACE_ATTACH_CHANNEL, async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (owner === null || !fromOwnWindow(event)) {
        return { ok: false, message: 'That request was rejected.' } as const
      }
      if (!workspaceChosen) {
        return { ok: false, message: 'Choose the folder your teammates work in first.' } as const
      }
      /*
       * A drive cannot put a hand in a native file dialog, and `attachFiles`
       * cannot be stubbed from the page either -- contextBridge exposes the
       * bridge non-configurable, so a drive that tried got "Cannot redefine
       * property: desktop". So a drive says which paths the dialog would have
       * returned, the same way `LOCUST_HIDE_RUNTIMES` stands in for a machine
       * with nothing installed.
       *
       * It is not a way past anything: the containment below runs on these
       * paths exactly as it runs on a person's, so this can still only ever
       * attach a file inside the workspace.
       */
      const scripted = process.env.LOCUST_ATTACH_PATHS
      const picked = scripted !== undefined && scripted.length > 0
        ? { canceled: false, filePaths: scripted.split(';').filter((entry) => entry.length > 0) }
        : await dialog.showOpenDialog(owner, {
            title: 'Attach files',
            buttonLabel: 'Attach',
            // Opens in the workspace because that is where most attachments
            // are. Anywhere else is fine now -- a file from outside is copied
            // in rather than refused, which is what the handler below does.
            defaultPath: workspacePath,
            properties: ['openFile', 'multiSelections']
          })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, message: '' } as const
      }
      /*
       * A file from outside the folder is COPIED IN rather than refused.
       *
       * It used to be refused flat, and Colin sent a screenshot of that
       * sentence: "we should definitely be able to share photos or attach
       * stuff outside of the folder much like claude." The refusal was not
       * wrong about the runtimes -- measured, only Cursor will read an
       * absolute path outside its folder; Claude, Copilot and OpenCode all
       * decline it -- so the fix is to bring the file to where every one of
       * them can already read it, not to point them somewhere they cannot go.
       *
       * See `attach-outside.ts` for why it lands in one named folder and why
       * that folder is kept out of git.
       */
      const chosenPaths = picked.filePaths.slice(0, MAX_ATTACHMENTS)
      const inside: string[] = []
      const copiedIn: string[] = []
      const taken = new Set(await readAttachmentNames(workspacePath))
      let failed = 0
      for (const chosen of chosenPaths) {
        const decision = decideReveal(chosen, [workspacePath])
        if (decision.ok) {
          inside.push(relative(workspacePath, decision.path).split('\\').join('/'))
          continue
        }
        try {
          const destination = attachmentDestination(chosen, taken)
          taken.add(basename(destination))
          await mkdir(join(workspacePath, ATTACHMENT_DIR), { recursive: true })
          // `copyFile` rather than a read-then-write: it is one syscall, it
          // keeps the bytes exactly (these are images as often as text), and
          // the destination is already known not to exist.
          await copyFile(chosen, join(workspacePath, destination))
          await keepAttachmentsOutOfGit(workspacePath)
          inside.push(destination)
          copiedIn.push(destination)
        } catch {
          failed += 1
        }
      }
      if (inside.length === 0) {
        return {
          ok: false,
          message:
            failed === 0
              ? 'Nothing was attached.'
              : 'Those files could not be copied into the folder your teammates work in.'
        } as const
      }
      return {
        ok: true,
        paths: inside,
        // Which ones came from outside, so the composer can mark those tiles.
        // Not a sentence any more: the fact is durable and belongs on the
        // durable object. See AttachFilesResponse.
        ...(copiedIn.length === 0 ? {} : { copied: copiedIn })
      } as const
    })

    ipcMain.handle(WORKSPACE_SETTINGS_WRITE_CHANNEL, async (event, settings: unknown) => {
      if (!fromOwnWindow(event)) return { swarm: false, relay: true, relayHopCap: DEFAULT_RELAY_HOP_CAP, memoryMode: DEFAULT_MEMORY_MODE, autoMode: false, askConnectors: false, keepATodoList: false, layout: 'auto', tube: 'full' } as const
      try {
        return await teammates.writeSettings(settings)
      } catch {
        /*
         * The write failed, so answer with what is ACTUALLY STORED.
         *
         * This used to return hardcoded defaults, which is worse than
         * unhelpful: the renderer sets its switches from whatever comes back,
         * so a failed write told it relay was ON and Auto was OFF regardless
         * of the file on disk. Someone running with relay off would watch it
         * appear to switch itself on, and then switch back at the next launch
         * when the real file was read again.
         *
         * The settings on disk are the truth whether or not this write landed.
         * If even reading them fails the defaults are all that is left, and
         * that is the one case where inventing them is the honest answer --
         * there is nothing else to say.
         */
        return await teammates.readSettings().catch(() => ({
          swarm: false,
          relay: true,
          relayHopCap: DEFAULT_RELAY_HOP_CAP,
          memoryMode: DEFAULT_MEMORY_MODE,
          autoMode: false,
          askConnectors: false,
          keepATodoList: false,
          layout: 'auto'
        } as const))
      }
    })

    ipcMain.handle(TEAMMATE_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return teammatesUnavailable
      try {
        const [list, missionOwners, missionTitles] = await Promise.all([
          teammates.list(),
          teammates.missionOwners(),
          teammates.missionTitles()
        ])
        return { ok: true, data: { teammates: list, missionOwners, missionTitles } } as const
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

    ipcMain.handle(TEAMMATE_RENAME_MISSION_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return teammateRejected('The conversation could not be renamed.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      try {
        await teammates.renameMission(String(input.missionId ?? ''), String(input.title ?? ''))
        return { ok: true, data: {} } as const
      } catch {
        return teammateRejected('That conversation could not be renamed.')
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

    ipcMain.handle(ROOM_RENAME_CHANNEL, async (event, request: unknown) => {
      if (!fromOwnWindow(event)) return roomRejected('The room could not be renamed.')
      const input = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
      if (typeof input.roomId !== 'string') return roomRejected('That room could not be renamed.')
      try {
        // The store validates the name and says what is wrong with it, so its
        // words reach the person rather than a sentence made up here.
        return { ok: true, data: { room: await rooms.rename(input.roomId, input.name) } } as const
      } catch (error) {
        return roomRejected(error instanceof Error ? error.message : 'That room could not be renamed.')
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

    /**
     * Start one room member's mission, or say why not.
     *
     * Pulled out of the post handler so the QUEUE can use it too: a member
     * who had no slot when the post went out is started by exactly this
     * path when one frees, on the same route, with the same briefing.
     *
     * `retryable` is the whole point of the split. RUN_ALREADY_ACTIVE means
     * "not now" -- the live cap is full, or that teammate is already working
     * -- and waiting fixes both. Everything else (gone from the roster,
     * Antigravity, approve-each) is a refusal that waiting will not fix, and
     * only those are recorded against the post as refused.
     */
    const startRoomMember = async (
      room: PublicRoom,
      teammateId: string,
      text: string,
      roster: readonly PublicTeammate[]
    ): Promise<
      | { readonly ok: true; readonly data: CodexMissionStartData }
      | { readonly ok: false; readonly name: string; readonly message: string; readonly retryable: boolean }
    > => {
      const teammate = roster.find((entry) => entry.teammateId === teammateId)
      const peer = await peerContextFor(teammateId)
      if (teammate === undefined || peer === undefined) {
        return { ok: false, name: teammate?.name ?? teammateId, message: 'No longer on the roster.', retryable: false }
      }
      const route = teammate.route ?? { runtime: 'codex' as const, model: 'account-default', mode: 'ask' as const }
      // The person's words, then the board: which room this is, who else
      // is in it, every task as it stands, and how to move one. The room
      // keeps only the person's words as the post; this trailer is what
      // the mission is briefed with. Read fresh, so a member started from
      // the queue is briefed with the board as it stands NOW.
      const memberNames = room.teammateIds.map((id: string) => roster.find((entry) => entry.teammateId === id)?.name ?? id)
      const briefed = `${text}

${taskSection({
        roomName: room.name,
        selfName: teammate.name,
        memberNames,
        tasks: room.tasks.map((task: PublicRoom['tasks'][number]) => ({
          text: task.text,
          state: task.state,
          ownerName: task.ownerId === undefined ? undefined : roster.find((entry) => entry.teammateId === task.ownerId)?.name ?? task.ownerId
        }))
      })}`
      if (route.runtime === 'antigravity') {
        return { ok: false, name: teammate.name, message: 'Antigravity cannot be posted to from a room yet.', retryable: false }
      }
      const response = await codexMissions.start(
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
        return {
          ok: false,
          name: teammate.name,
          message: response.error.message,
          retryable: response.error.code === 'RUN_ALREADY_ACTIVE'
        }
      }
      await assignOwner(teammateId, response.data.missionId)
      return { ok: true, data: response.data }
    }


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
      const refusals: { teammateId: string; name: string; message: string }[] = []
      const roster = await teammates.list()

      /*
       * THE POST EXISTS BEFORE ANYONE IS ASKED.
       *
       * It used to be written at the END: start everyone in sequence, then
       * record the post, then announce every run at once. So a person
       * watched an empty room while work was already underway -- Astra
       * measured a process running 45,292 ms before its own row appeared,
       * and it is the cause of every "cards: 0" the room drives reported
       * immediately after posting, which I had seen and not explained.
       *
       * Now everyone starts QUEUED, and each member leaves the queue the
       * moment their run begins -- announced there and then. Which is
       * exactly what `room-tasks` does when a slot frees, so the two paths
       * are one path, and a post that cannot reach everyone at once is the
       * same thing as a post that reaches them slowly.
       */
      let post: RoomPost
      try {
        post = await rooms.addPost(roomId, { text, missions: {}, queued: [...room.teammateIds] })
      } catch (error) {
        return roomRejected(error instanceof Error ? error.message : 'The post could not be recorded.')
      }
      // Said the moment it is on disk. Everything below this line can take as
      // long as a cold runtime needs; the person's own words are already on
      // screen where they put them.
      sendToWindow({ kind: 'room-posted', roomId, postId: post.postId })

      for (const teammateId of room.teammateIds) {
        const attempt = await startRoomMember(room, teammateId, text, roster)
        if (!attempt.ok) {
          /*
           * "Not now" is not a refusal.
           *
           * `attempt.retryable` marks the two cases waiting fixes -- the
           * live cap is full, or that teammate is already working. Those
           * members wait in the post's queue and are started by
           * `room-tasks` the moment a slot frees. Everything else -- gone
           * from the roster, a runtime a room cannot post to -- is recorded
           * as refused, because waiting will never fix it.
           */
          if (attempt.retryable) continue
          refusals.push({ teammateId, name: attempt.name, message: attempt.message })
          await rooms.refuseQueued(roomId, post.postId, teammateId, attempt.message).catch(() => undefined)
          continue
        }
        await rooms.startQueued(roomId, post.postId, teammateId, attempt.data.missionId).catch(() => undefined)
        /*
         * Claim the row the person named, at START -- on THIS path.
         *
         * `room-tasks` has done this since 0.116.0, but only where a queued
         * member is drained after some other run ends. Grok measured the
         * hole on the second pass (2026-09-14, finding 1): the post that
         * actually starts the named teammate comes through here, so the one
         * member the person pointed at was the one member the claim never
         * saw. The row sat unassigned through the whole live run and was
         * claimed only by the reply's own end-of-text block, which is what
         * 0.116.0 already had.
         *
         * Read fresh: members ahead of this one in the loop may have moved
         * the board since the post was made.
         */
        const current = await rooms.get(roomId).catch(() => undefined)
        const named =
          current === undefined
            ? undefined
            : rowToClaimAtStart({
                postText: text,
                tasks: current.tasks,
                members: roster.filter((mate) => current.teammateIds.includes(mate.teammateId)),
                startedTeammateId: teammateId
              })
        if (named !== undefined) {
          // A claim that fails does not hold up a run that has already
          // started: the board is behind, not broken.
          await rooms.updateTask({ roomId, op: 'assign', taskId: named, ownerId: teammateId }).catch(() => undefined)
        }
        // Said HERE, not after the loop: this is the moment the row can
        // appear, and every member after this one is still to be asked.
        sendToWindow({
          kind: 'mission-started',
          runId: attempt.data.runId,
          missionId: attempt.data.missionId,
          teammateId,
          prompt: text,
          data: attempt.data,
          startedBy: { kind: 'room', roomId, postId: post.postId }
        })
      }
      // The post as it now stands, so the answer carries who started, who is
      // waiting and who was refused rather than the empty one written above.
      post = (await rooms.get(roomId))?.posts.find((entry) => entry.postId === post.postId) ?? post
      return { ok: true, data: { post, refused: refusals } } as const
    })

    ipcMain.handle(ROUTINE_LIST_CHANNEL, async (event) => {
      if (!fromOwnWindow(event)) return { ok: false, error: { code: 'ROUTINES_UNAVAILABLE', message: 'Routines are unavailable.' } } as const
      try {
        await routineRunner?.reconcile()
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

    ipcMain.handle(ROUTINE_RECOVERY_CHANNEL, (event, request: unknown) =>
      decideRoutineRecovery(request, fromOwnWindow(event), workspaceChosen, routineRunner))

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
      if (!fromOwnWindow(event)) return { name: 'Locust', version: 'unknown', packaged: app.isPackaged, platform: process.platform, workspaceName: '', workspacePath: '', workspaceMade: false, ledgerPath: '' } as const
      // The version electron-builder stamped, which is the one on the installer.
      return {
        name: 'Locust',
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        workspaceName: workspaceChosen ? basename(workspacePath) || workspacePath : '',
        workspacePath: workspaceChosen ? workspacePath : '',
        workspaceMade,
        // Where the receipts live. The renderer needs it for one thing: when a
        // write to the ledger fails, the card offers to open the folder, and
        // an offer to show someone a place has to know which place.
        ledgerPath: ledgerDirectory
      } as const
    })

    // Updates. A packaged build can replace itself; a development build
    // cannot, and says so rather than reporting itself up to date.
    const updates = createUpdateService({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      supported: app.isPackaged,
      liveMissionCount: () =>
        codexMissions.liveMissionIds().length + antigravityMissions.liveMissionIds().length,
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
        [...codexMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()]
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
        () => [...codexMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()],
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
        (id) => codexMissions.hasMission(id) || antigravityMissions.hasMission(id)
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
      /*
       * Validated BEFORE the peer context is built, because building it has
       * a side effect: a teammate set to work on its own branch gets its
       * worktree made by `ensure`. A start that is about to be refused must
       * not leave a branch behind, and every path below needs a prompt, so
       * the one check belongs here rather than in three of them.
       */
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        return { ok: false, error: { code: 'INVALID_PROMPT', message: 'Enter a mission first.' } } as const
      }
      // Resolve before choosing a transport: discovery in the renderer may
      // still be partial, but the host already knows this teammate's route.
      const peer = await peerContextFor(payload.teammateId)
      const { runtime, model, effort } = routeAtStart(payload, peer?.self)
      // `approve-each` needs a runtime able to stop and ask, and only Codex
      // has one. Another runtime asked for it would have been started on
      // Codex without a word; it is refused instead.
      if (runtime === 'antigravity') {
        // The prompt was checked above, before the peer context was built.
        if (mode !== 'accept-edits') {
          return {
            ok: false,
            error: {
              code: 'RUNTIME_START_FAILED',
              message: "Antigravity runs its own agent with its own permissions; Locust cannot hold it read-only. Choose Accept edits, or another route."
            }
          } as const
        }
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
      try {
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
      // Not one of the mission service's runs: Antigravity owns its own, and a
      // stop control that only knew one transport reported "no longer active"
      // at a run that was very much still going.
      if (antigravityMissions.cancel(runId)) {
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

    /*
     * The loading window first, then the app behind it.
     *
     * `tube: 'off'` is a person saying they do not want the ceremony, so
     * they get no splash and the app opens straight away.
     */
    const openSplash = (tube: string): void => {
      if (tube === 'off') return
      splashWindow = createSplashWindow()
      splashWindow.on('closed', () => {
        splashWindow = undefined
        // Whatever became of the splash -- finished, or closed by hand --
        // the app must not be left invisible behind it.
        showAppWindow()
      })
    }
    // Read, not assumed: somebody who turned the ceremony off gets no
    // loading window and the app opens straight away. Synchronously
    // optimistic, because the splash must exist BEFORE the app window is
    // ready to show or the app would show itself first.
    openSplash('full')
    /*
     * A CAP ON THE LOADING SCREEN.
     *
     * A probe that never answers must not mean an app that never opens --
     * that is far worse than a slow start, and it is the failure a loading
     * screen makes possible in the first place. After this the app is shown
     * and the splash closed regardless, and the runtimes carry on answering
     * behind it exactly as they did before there was a splash at all.
     */
    setTimeout(() => {
      const splash = splashWindow
      if (splash === undefined || splash.isDestroyed()) return
      splashWindow = undefined
      showAppWindow()
      splash.close()
    }, SPLASH_CAP_MS)
    void teammates
      .readSettings()
      .then((held) => {
        if (held.tube !== 'off') return
        const splash = splashWindow
        splashWindow = undefined
        if (splash !== undefined && !splash.isDestroyed()) splash.close()
      })
      .catch(() => undefined)

    createWindow(codexMissions, (window) => {
      approvalWindow = window
      replayDiscoveryToWindow()
      // The sweep may begin: there is somebody to watch it now.
      windowIsUp()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(codexMissions, (window) => {
          approvalWindow = window
          replayDiscoveryToWindow()
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
/** How long the flush below is allowed to take -- see `boundedShutdown`. */
const SHUTDOWN_DEADLINE_MS = 6_000
if (ownsSingleInstanceLock) {
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    boundedShutdown({
      deadlineMs: SHUTDOWN_DEADLINE_MS,
      work: async () => {
        await missionServiceForShutdown?.dispose()
        await ledgerForShutdown?.flush()
        await workroomForShutdown?.flush()
        // Refuses whatever a run was still asking, and closes the loopback door.
        await permissionHostForShutdown?.dispose()
      },
      leave: (reason) => {
        shutdownComplete = true
        // Whoever asked for the quit gets the last word: the updater installs
        // and starts the app again. Anything else is an ordinary quit.
        const finalise = quitFinaliser
        quitFinaliser = undefined
        if (finalise !== undefined) {
          finalise()
          return
        }
        if (reason === 'finished') {
          app.quit()
          return
        }
        // The wait was abandoned, so re-entering the quit would only wait
        // again. `app.exit` is the one way out that a stuck child process
        // cannot hold, and the relaunch helper watches the process rather
        // than its exit code, so a folder switch still reopens from here.
        console.error(`Shutdown did not finish within ${String(SHUTDOWN_DEADLINE_MS)}ms; leaving anyway.`)
        app.exit(0)
      },
      failed: (error) => {
        console.error('Failed to flush the local mission ledger during shutdown', error)
        app.exit(1)
      }
    })
  })
}

/** Names already in the attachments folder, so a copy never overwrites one. */
async function readAttachmentNames(workspacePath: string): Promise<readonly string[]> {
  try {
    return await readdir(join(workspacePath, ATTACHMENT_DIR))
  } catch {
    // No folder yet is the ordinary first case, not a failure.
    return []
  }
}

/**
 * Keep the attachments folder out of the person's commits.
 *
 * `.git/info/exclude`, not `.gitignore`: their ignore file is tracked and
 * belongs to them, and a line Locust added would show up as a change they did
 * not make. A workspace that is not a git repository has neither, and nothing
 * here needs to happen.
 */
async function keepAttachmentsOutOfGit(workspacePath: string): Promise<void> {
  const excludePath = join(workspacePath, '.git', 'info', 'exclude')
  try {
    let current = ''
    try {
      current = await readFile(excludePath, 'utf8')
    } catch {
      // A repository with no exclude file yet: write one, but only if the
      // folder it belongs in is really there, so this cannot invent a .git.
      await readdir(join(workspacePath, '.git'))
      await mkdir(join(workspacePath, '.git', 'info'), { recursive: true })
    }
    const next = excludeWith(current)
    if (next !== undefined) await writeFile(excludePath, next, 'utf8')
  } catch {
    // Not a repository, or an unwritable one. The attachment still works;
    // this was only ever tidiness.
  }
}
