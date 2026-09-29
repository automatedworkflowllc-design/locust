import { contextBridge, ipcRenderer } from 'electron'
import type { CompareSlotId } from '../shared/compare.js'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL,
  MISSION_APPROVAL_CHANNEL,
  MISSION_APPROVAL_DECIDE_CHANNEL,
  MISSION_APPROVAL_WITHDRAWN_CHANNEL,
  MISSION_HANDOFF_CHANNEL,
  MISSION_RESUME_CHANNEL,
  APP_INFO_CHANNEL,
  NEEDS_YOU_COUNT_CHANNEL,
  RUN_FINISHED_CHANNEL,
  ATTENTION_OPEN_MISSION_CHANNEL,
  APP_CHANGELOG_CHANNEL,
  APP_CHANGELOG_SEEN_CHANNEL,
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_LANE_CHANNEL,
  APP_UPDATE_STATE_CHANNEL,
  MISSION_PRUNE_CHANNEL,
  MISSION_STORAGE_CHANNEL,
  MISSION_DELETE_CHANNEL,
  MISSION_TRASH_LIST_CHANNEL,
  MISSION_RESTORE_CHANNEL,
  MISSION_TRASH_EMPTY_CHANNEL,
  MISSION_HISTORY_CHANNEL,
  MISSION_READ_CHANNEL,
  MODEL_CATALOG_CHANNEL,
  RUNTIME_ARTIFACTS_CHANNEL,
  RUNTIME_INSTALL_CHANNEL,
  RUNTIME_SIGN_IN_CHANNEL,
  OPEN_IN_TERMINAL_CHANNEL,
  TERMINAL_CATCH_UP_CHANNEL,
  SESSION_IMPORT_LIST_CHANNEL,
  SESSION_IMPORT_CHANNEL,
  TEAM_CARD_SAVE_CHANNEL,
  TEAM_CARD_ADD_CHANNEL,
  RUNTIME_INSTALL_PROGRESS_CHANNEL,
  RUNTIME_UPDATES_CHANNEL,
  RUNTIME_UPDATES_EVENT_CHANNEL,
  RUNTIME_UPDATES_NOW_CHANNEL,
  RUNTIME_UPDATES_SET_CHANNEL,
  RUNTIME_DISCOVERY_CHANNEL,
  RUNTIME_DISCOVERY_EVENT_CHANNEL,
  RUNTIME_DISCOVERY_LOG_CHANNEL,
  SPLASH_DONE_CHANNEL,
  WORKSPACE_SETTINGS_READ_CHANNEL,
  WORKSPACE_SETTINGS_WRITE_CHANNEL,
  WORKSPACE_CHOOSE_CHANNEL,
  FOLDER_LIST_CHANNEL,
  SIDE_ASK_CHANNEL,
  FOLDER_SWITCH_CHANNEL,
  WORKSPACE_ATTACH_CHANNEL,
  WORKSPACE_FILES_CHANNEL,
  WORKSPACE_PASTE_CHANNEL,
  WORKSPACE_IMAGE_CHANNEL,
  WORKSPACE_REVEAL_CHANNEL,
  WORKSPACE_SAVE_COPY_CHANNEL,
  WORKSPACE_TEXT_CHANNEL,
  WORKSPACE_PAGE_CHANNEL,
  RUNTIME_COMMANDS_CHANNEL,
  DIAGNOSTICS_REVEAL_CHANNEL,
  FEEDBACK_CHANNEL,
  DIAGNOSTICS_REPORT_CHANNEL,
  OPEN_LINK_CHANNEL,
  ROOM_LIST_CHANNEL,
  ROOM_CREATE_CHANNEL,
  ROOM_REMOVE_CHANNEL,
  ROOM_RENAME_CHANNEL,
  ROOM_POST_CHANNEL,
  TEAMMATES_TAG_CHANNEL,
  COMPARE_START_CHANNEL,
  COMPARE_ASK_CHANNEL,
  COMPARE_KEEP_CHANNEL,
  COMPARE_RETRY_CHANNEL,
  COMPARE_CHANGES_CHANNEL,
  COMPARE_CHANGES_REFUSAL_CHANNEL,
  COMPARE_LIST_CHANNEL,
  ROOM_TASK_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  TEAMMATE_RENAME_MISSION_CHANNEL,
  GROUP_LIST_CHANNEL,
  GROUP_CREATE_CHANNEL,
  GROUP_RENAME_CHANNEL,
  GROUP_REMOVE_CHANNEL,
  GROUP_ASSIGN_CHANNEL,
  GROUP_INSTRUCTIONS_CHANNEL,
  GROUP_ROUTE_CHANNEL,
  ROUTINE_LIST_CHANNEL,
  ROUTINE_CREATE_CHANNEL,
  ROUTINE_UPDATE_CHANNEL,
  ROUTINE_REMOVE_CHANNEL,
  ROUTINE_RUN_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL,
  TEAMMATE_UPDATE_CHANNEL,
  TEAMMATE_SPEND_CHANNEL,
  OWN_MODEL_LIST_CHANNEL,
  OWN_MODEL_ADD_CHANNEL,
  OWN_MODEL_REMOVE_CHANNEL,
  OWN_MODEL_TEST_CHANNEL,
  OWN_MODEL_CHAT_ONLY_CHANNEL,
  MEMORY_LIST_CHANNEL,
  MEMORY_ADD_CHANNEL,
  MEMORY_UPDATE_CHANNEL,
  MEMORY_REMOVE_CHANNEL,
  MEMORY_CLEAR_CHANNEL,
  MEMORY_RESTORE_CHANNEL,
  RUNTIME_SETUP_CHANNEL,
  CONNECTOR_LIST_CHANNEL,
  TEAMMATE_CONNECTORS_CHANNEL,
  TEAMMATE_FOLDER_CHANNEL,
  WORKTREE_LIST_CHANNEL,
  WORKTREE_REMOVE_CHANNEL,
  WORKTREE_REVIEW_CHANNEL,
  WORKTREE_TURN_DIFF_CHANNEL,
  WORKTREE_LAND_PREVIEW_CHANNEL,
  WORKTREE_LAND_CHANNEL,
  WORKTREE_RESOLVE_CHANNEL
} from '../shared/ipc.js'
import type {
  CodexMissionCancelRequest,
  TeammateRoute,
  DiscoveryEvent,
  CodexMissionCancelResponse,
  CodexMissionStartRequest,
  CodexMissionStartResponse,
  CodexMissionUpdate,
  DesktopApi,
  MissionApprovalAnswer,
  MissionApprovalRequest,
  MissionHandoffRequest,
  MissionResumeRequest,
  MissionHandoffResponse,
  AppInfo,
  AppChangelog,
  AppUpdateResponse,
  AppUpdateState,
  MissionPruneRequest,
  MissionPruneResponse,
  MissionReadResponse,
  TrashListResponse,
  TrashMutationResponse,
  StorageReportResponse,
  MissionDeleteResponse,
  MissionHistoryResponse,
  ModelCatalogResponse,
  PublicRuntimeArtifact,
  RuntimeDiscoveryResponse,
  WorkspaceSettings,
  WorkspaceChooseResponse,
  FolderListResponse,
  SideAskResponse,
  FolderSwitchResponse,
  AttachFilesResponse,
  WorkspaceFilesResponse,
  OpenLinkResponse,
  FeedbackReport,
  RevealFileResponse,
  WorkspaceTextResponse,
  WorkspacePageResponse,
  RuntimeCommandsResponse,
  DiagnosticsReport,
  GroupListResponse,
  GroupMutationResponse,
  WorkspaceImageResponse,
  RoomListResponse,
  RoomMutationResponse,
  RoomPostResponse,
  TagTeammatesRequest,
  TagTeammatesResponse,
  CompareStartRequest,
  CompareResponse,
  CompareChangesResponse,
  CompareListResponse,
  RoomCreateRequest,
  RoomPostRequest,
  RoomTaskRequest,
  RoomTaskResponse,
  TeammateCreateRequest,
  TeammateListResponse,
  TeammateMutationResponse,
  TeammateSpendResponse,
  TeammateUpdateRequest,
  OwnModelAddRequest,
  OwnModelListResponse,
  OwnModelMutationResponse,
  OwnModelTestRequest,
  OwnModelTestResponse,
  RoutineCreateRequest,
  RoutineListResponse,
  RoutineMutationResponse,
  RoutineRunResponse,
  RoutineUpdateRequest,
  MemoryAddRequest,
  MemoryClearRequest,
  MemoryListResponse,
  MemoryUpdateRequest,
  RuntimeSetupResponse,
  ConnectorListResponse,
  TeammateFolderResponse,
  WorktreeListResponse,
  BranchReviewResponse,
  TurnDiffResponse,
  LandPreviewResponse,
  LandResponse,
  ResolveResponse,
  RuntimeInstallProgress,
  RuntimeUpdatesState,
  RuntimeInstallResponse,
  RuntimeSignInResponse,
  OpenInTerminalResponse,
  TerminalCatchUpResponse,
  SessionImportListResponse,
  SessionImportResponse,
  TeamCardRect,
  TeamCardSaveResponse,
  TeamCardAddResponse
} from '../shared/ipc.js'
import { ROUTINE_RECOVERY_CHANNEL } from '../shared/routine-recovery.js'
import type { RoutineRecoveryRequest, RoutineRecoveryResponse } from '../shared/routine-recovery.js'

export type {
  CodexMissionCancelRequest,
  CodexMissionCancelResponse,
  CodexMissionStartRequest,
  CodexMissionStartResponse,
  CodexMissionUpdate,
  DesktopApi,
  LocalRuntimeId,
  MissionHistoryResponse,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  MissionApprovalDecision,
  MissionApprovalKind,
  MissionApprovalRequest,
  MissionMode,
  ModelCatalogResponse,
  PublicRuntimeArtifact,
  PublicModel,
  WorkspaceSettings,
  WorkspaceChooseResponse,
  PublicTeammate,
  TeammateCreateRequest,
  TeammateHue,
  TeammateListResponse,
  TeammateMutationResponse,
  TeammateRole,
  RuntimeAuthState,
  RuntimeDiscoveryResponse,
  RuntimeProbeStatus
} from '../shared/ipc.js'

const desktopApi: DesktopApi = {
  platform: process.platform,
  setNeedsYouCount: (count) => ipcRenderer.send(NEEDS_YOU_COUNT_CHANNEL, count),
  notifyFinished: (finish) => ipcRenderer.send(RUN_FINISHED_CHANNEL, finish),
  onAttentionOpenMission: (listener: (missionId: string) => void) => {
    const handler = (_event: unknown, missionId: unknown): void => {
      if (typeof missionId === 'string') listener(missionId)
    }
    ipcRenderer.on(ATTENTION_OPEN_MISSION_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(ATTENTION_OPEN_MISSION_CHANNEL, handler)
    }
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
  getChangelog: () => ipcRenderer.invoke(APP_CHANGELOG_CHANNEL) as Promise<AppChangelog>,
  markChangelogSeen: () => ipcRenderer.invoke(APP_CHANGELOG_SEEN_CHANNEL) as Promise<void>,
  readStorageReport: () => ipcRenderer.invoke(MISSION_STORAGE_CHANNEL) as Promise<StorageReportResponse>,
  checkForUpdate: () => ipcRenderer.invoke(APP_UPDATE_CHECK_CHANNEL) as Promise<AppUpdateResponse>,
  installUpdate: () => ipcRenderer.invoke(APP_UPDATE_INSTALL_CHANNEL) as Promise<AppUpdateResponse>,
  setUpdateLane: (everyBuild: boolean) => ipcRenderer.invoke(APP_UPDATE_LANE_CHANNEL, everyBuild) as Promise<AppUpdateResponse>,
  onUpdateState: (listener: (state: AppUpdateState) => void) => {
    const handler = (_event: unknown, state: AppUpdateState): void => {
      listener(state)
    }
    ipcRenderer.on(APP_UPDATE_STATE_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(APP_UPDATE_STATE_CHANNEL, handler)
    }
  },
  pruneMissions: (request: MissionPruneRequest) =>
    ipcRenderer.invoke(MISSION_PRUNE_CHANNEL, request) as Promise<MissionPruneResponse>,
  getLocalRuntimes: (fresh?: boolean, only?: readonly string[]) =>
    ipcRenderer.invoke(RUNTIME_DISCOVERY_CHANNEL, fresh === true, only === undefined ? undefined : [...only]) as Promise<RuntimeDiscoveryResponse>,
  getMissionHistory: (known?: Readonly<Record<string, string>>) =>
    ipcRenderer.invoke(MISSION_HISTORY_CHANNEL, known === undefined ? undefined : { ...known }) as Promise<MissionHistoryResponse>,
  deleteMission: (missionId: string) =>
    ipcRenderer.invoke(MISSION_DELETE_CHANNEL, missionId) as Promise<MissionDeleteResponse>,
  listTrashedMissions: () => ipcRenderer.invoke(MISSION_TRASH_LIST_CHANNEL) as Promise<TrashListResponse>,
  restoreMission: (missionId: string) =>
    ipcRenderer.invoke(MISSION_RESTORE_CHANNEL, missionId) as Promise<TrashMutationResponse>,
  emptyTrash: () => ipcRenderer.invoke(MISSION_TRASH_EMPTY_CHANNEL) as Promise<TrashMutationResponse>,
  listTeammates: () => ipcRenderer.invoke(TEAMMATE_LIST_CHANNEL) as Promise<TeammateListResponse>,
  createTeammate: (request: TeammateCreateRequest) =>
    ipcRenderer.invoke(TEAMMATE_CREATE_CHANNEL, request) as Promise<TeammateMutationResponse>,
  removeTeammate: (teammateId: string) =>
    ipcRenderer.invoke(TEAMMATE_REMOVE_CHANNEL, teammateId) as Promise<TeammateMutationResponse>,
  updateTeammate: (request: TeammateUpdateRequest) =>
    ipcRenderer.invoke(TEAMMATE_UPDATE_CHANNEL, request) as Promise<TeammateMutationResponse>,
  teammateSpend: () => ipcRenderer.invoke(TEAMMATE_SPEND_CHANNEL) as Promise<TeammateSpendResponse>,
  listOwnModels: () => ipcRenderer.invoke(OWN_MODEL_LIST_CHANNEL) as Promise<OwnModelListResponse>,
  addOwnModel: (request: OwnModelAddRequest) => ipcRenderer.invoke(OWN_MODEL_ADD_CHANNEL, request) as Promise<OwnModelMutationResponse>,
  removeOwnModel: (ownId: string) => ipcRenderer.invoke(OWN_MODEL_REMOVE_CHANNEL, ownId) as Promise<OwnModelMutationResponse>,
  testOwnModel: (request: OwnModelTestRequest) => ipcRenderer.invoke(OWN_MODEL_TEST_CHANNEL, request) as Promise<OwnModelTestResponse>,
  setOwnModelChatOnly: (ownId: string, chatOnly: boolean) =>
    ipcRenderer.invoke(OWN_MODEL_CHAT_ONLY_CHANNEL, { ownId, chatOnly }) as Promise<OwnModelMutationResponse>,
  assignMission: (teammateId: string, missionId: string) =>
    ipcRenderer.invoke(TEAMMATE_ASSIGN_CHANNEL, { teammateId, missionId }) as Promise<TeammateMutationResponse>,
  renameMission: (missionId: string, title: string) =>
    ipcRenderer.invoke(TEAMMATE_RENAME_MISSION_CHANNEL, { missionId, title }) as Promise<TeammateMutationResponse>,
  listGroups: () => ipcRenderer.invoke(GROUP_LIST_CHANNEL) as Promise<GroupListResponse>,
  createGroup: (name: string) => ipcRenderer.invoke(GROUP_CREATE_CHANNEL, name) as Promise<GroupMutationResponse>,
  renameGroup: (groupId: string, name: string) =>
    ipcRenderer.invoke(GROUP_RENAME_CHANNEL, { groupId, name }) as Promise<GroupMutationResponse>,
  removeGroup: (groupId: string) => ipcRenderer.invoke(GROUP_REMOVE_CHANNEL, groupId) as Promise<GroupMutationResponse>,
  assignGroup: (missionId: string, groupId: string | undefined) =>
    ipcRenderer.invoke(GROUP_ASSIGN_CHANNEL, { missionId, groupId }) as Promise<GroupMutationResponse>,
  setGroupInstructions: (groupId: string, instructions: string) =>
    ipcRenderer.invoke(GROUP_INSTRUCTIONS_CHANNEL, { groupId, instructions }) as Promise<GroupMutationResponse>,
  setGroupRoute: (groupId: string, route: TeammateRoute | undefined) =>
    ipcRenderer.invoke(GROUP_ROUTE_CHANNEL, { groupId, route }) as Promise<GroupMutationResponse>,
  listRoutines: () => ipcRenderer.invoke(ROUTINE_LIST_CHANNEL) as Promise<RoutineListResponse>,
  createRoutine: (request: RoutineCreateRequest) =>
    ipcRenderer.invoke(ROUTINE_CREATE_CHANNEL, request) as Promise<RoutineMutationResponse>,
  updateRoutine: (request: RoutineUpdateRequest) =>
    ipcRenderer.invoke(ROUTINE_UPDATE_CHANNEL, request) as Promise<RoutineMutationResponse>,
  removeRoutine: (routineId: string) =>
    ipcRenderer.invoke(ROUTINE_REMOVE_CHANNEL, routineId) as Promise<RoutineMutationResponse>,
  runRoutine: (routineId: string) => ipcRenderer.invoke(ROUTINE_RUN_CHANNEL, routineId) as Promise<RoutineRunResponse>,
  startCodexMission: (request: CodexMissionStartRequest) =>
    ipcRenderer.invoke(CODEX_MISSION_START_CHANNEL, request) as Promise<CodexMissionStartResponse>,
  cancelCodexMission: (request: CodexMissionCancelRequest) =>
    ipcRenderer.invoke(CODEX_MISSION_CANCEL_CHANNEL, request) as Promise<CodexMissionCancelResponse>,
  handOffMission: (request: MissionHandoffRequest) =>
    ipcRenderer.invoke(MISSION_HANDOFF_CHANNEL, request) as Promise<MissionHandoffResponse>,
  resumeMission: (request: MissionResumeRequest) =>
    ipcRenderer.invoke(MISSION_RESUME_CHANNEL, request) as Promise<MissionHandoffResponse>,
  listModels: () => ipcRenderer.invoke(MODEL_CATALOG_CHANNEL) as Promise<ModelCatalogResponse>,
  listRuntimeArtifacts: () =>
    ipcRenderer.invoke(RUNTIME_ARTIFACTS_CHANNEL) as Promise<readonly PublicRuntimeArtifact[]>,
  /** Run `npm install -g <package>` for a runtime, watching npm's own output. */
  installRuntime: (runtime: string) =>
    ipcRenderer.invoke(RUNTIME_INSTALL_CHANNEL, runtime) as Promise<RuntimeInstallResponse>,
  signInRuntime: (runtime: string) =>
    ipcRenderer.invoke(RUNTIME_SIGN_IN_CHANNEL, runtime) as Promise<RuntimeSignInResponse>,
  openInTerminal: (missionId: string) =>
    ipcRenderer.invoke(OPEN_IN_TERMINAL_CHANNEL, missionId) as Promise<OpenInTerminalResponse>,
  catchUpTerminal: (missionId: string) =>
    ipcRenderer.invoke(TERMINAL_CATCH_UP_CHANNEL, missionId) as Promise<TerminalCatchUpResponse>,
  listImportableSessions: () => ipcRenderer.invoke(SESSION_IMPORT_LIST_CHANNEL) as Promise<SessionImportListResponse>,
  importSession: (runtime: 'claude' | 'codex', sessionId: string) =>
    ipcRenderer.invoke(SESSION_IMPORT_CHANNEL, { runtime, sessionId }) as Promise<SessionImportResponse>,
  saveTeamCard: (rect: TeamCardRect) => ipcRenderer.invoke(TEAM_CARD_SAVE_CHANNEL, rect) as Promise<TeamCardSaveResponse>,
  addTeamFromCard: () => ipcRenderer.invoke(TEAM_CARD_ADD_CHANNEL) as Promise<TeamCardAddResponse>,
  onRuntimeInstallProgress: (listener: (progress: RuntimeInstallProgress) => void) => {
    const handler = (_event: unknown, progress: RuntimeInstallProgress): void => listener(progress)
    ipcRenderer.on(RUNTIME_INSTALL_PROGRESS_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(RUNTIME_INSTALL_PROGRESS_CHANNEL, handler)
    }
  },
  readRuntimeUpdates: () => ipcRenderer.invoke(RUNTIME_UPDATES_CHANNEL) as Promise<RuntimeUpdatesState>,
  setRuntimeUpdates: (automatic: boolean) =>
    ipcRenderer.invoke(RUNTIME_UPDATES_SET_CHANNEL, automatic === true) as Promise<RuntimeUpdatesState>,
  updateRuntimeNow: (runtime: string) =>
    ipcRenderer.invoke(RUNTIME_UPDATES_NOW_CHANNEL, runtime) as Promise<RuntimeUpdatesState>,
  onRuntimeUpdates: (listener: (state: RuntimeUpdatesState) => void) => {
    const handler = (_event: unknown, state: RuntimeUpdatesState): void => listener(state)
    ipcRenderer.on(RUNTIME_UPDATES_EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(RUNTIME_UPDATES_EVENT_CHANNEL, handler)
    }
  },
  readWorkspaceSettings: () =>
    ipcRenderer.invoke(WORKSPACE_SETTINGS_READ_CHANNEL) as Promise<WorkspaceSettings>,
  chooseWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHOOSE_CHANNEL) as Promise<WorkspaceChooseResponse>,
  listFolders: () => ipcRenderer.invoke(FOLDER_LIST_CHANNEL) as Promise<FolderListResponse>,
  askOnTheSide: (of: string, question: string, count: number) => ipcRenderer.invoke(SIDE_ASK_CHANNEL, of, question, count) as Promise<SideAskResponse>,
  switchFolder: (id: string) => ipcRenderer.invoke(FOLDER_SWITCH_CHANNEL, id) as Promise<FolderSwitchResponse>,
  revealFile: (path: string) => ipcRenderer.invoke(WORKSPACE_REVEAL_CHANNEL, path) as Promise<RevealFileResponse>,
  saveCopy: (path: string) => ipcRenderer.invoke(WORKSPACE_SAVE_COPY_CHANNEL, path) as Promise<RevealFileResponse>,
  readTextFile: (path: string) => ipcRenderer.invoke(WORKSPACE_TEXT_CHANNEL, path) as Promise<WorkspaceTextResponse>,
  pageUrlFor: (path: string, column?: { readonly compareId: string; readonly slot: string }) => ipcRenderer.invoke(WORKSPACE_PAGE_CHANNEL, path, column) as Promise<WorkspacePageResponse>,
  runtimeCommands: () => ipcRenderer.invoke(RUNTIME_COMMANDS_CHANNEL) as Promise<RuntimeCommandsResponse>,
  revealDiagnostics: () => ipcRenderer.invoke(DIAGNOSTICS_REVEAL_CHANNEL) as Promise<void>,
  sendFeedback: (report: FeedbackReport) => ipcRenderer.invoke(FEEDBACK_CHANNEL, report) as Promise<OpenLinkResponse>,
  diagnosticsReport: () => ipcRenderer.invoke(DIAGNOSTICS_REPORT_CHANNEL) as Promise<DiagnosticsReport>,
  openLink: (url: string) => ipcRenderer.invoke(OPEN_LINK_CHANNEL, url) as Promise<OpenLinkResponse>,
  readWorkspaceImage: (path: string) =>
    ipcRenderer.invoke(WORKSPACE_IMAGE_CHANNEL, path) as Promise<WorkspaceImageResponse>,
  attachFiles: () => ipcRenderer.invoke(WORKSPACE_ATTACH_CHANNEL) as Promise<AttachFilesResponse>,
  workspaceFiles: () => ipcRenderer.invoke(WORKSPACE_FILES_CHANNEL) as Promise<WorkspaceFilesResponse>,
  attachPasted: (name: string, bytes: Uint8Array) =>
    ipcRenderer.invoke(WORKSPACE_PASTE_CHANNEL, { name, bytes }) as Promise<AttachFilesResponse>,
  listRooms: () => ipcRenderer.invoke(ROOM_LIST_CHANNEL) as Promise<RoomListResponse>,
  createRoom: (request: RoomCreateRequest) => ipcRenderer.invoke(ROOM_CREATE_CHANNEL, request) as Promise<RoomMutationResponse>,
  removeRoom: (roomId: string) => ipcRenderer.invoke(ROOM_REMOVE_CHANNEL, roomId) as Promise<RoomMutationResponse>,
  renameRoom: (roomId: string, name: string) =>
    ipcRenderer.invoke(ROOM_RENAME_CHANNEL, { roomId, name }) as Promise<RoomMutationResponse>,
  postToRoom: (request: RoomPostRequest) => ipcRenderer.invoke(ROOM_POST_CHANNEL, request) as Promise<RoomPostResponse>,
  tagTeammates: (request: TagTeammatesRequest) => ipcRenderer.invoke(TEAMMATES_TAG_CHANNEL, request) as Promise<TagTeammatesResponse>,
  startCompare: (request: CompareStartRequest) => ipcRenderer.invoke(COMPARE_START_CHANNEL, request) as Promise<CompareResponse>,
  askCompare: (compareId: string, prompt: string) => ipcRenderer.invoke(COMPARE_ASK_CHANNEL, compareId, prompt) as Promise<CompareResponse>,
  keepCompare: (compareId: string, slot: CompareSlotId) => ipcRenderer.invoke(COMPARE_KEEP_CHANNEL, compareId, slot) as Promise<CompareResponse>,
  retryCompare: (compareId: string, slot: CompareSlotId) => ipcRenderer.invoke(COMPARE_RETRY_CHANNEL, compareId, slot) as Promise<CompareResponse>,
  compareChanges: (compareId: string) => ipcRenderer.invoke(COMPARE_CHANGES_CHANNEL, compareId) as Promise<CompareChangesResponse>,
  compareChangesRefusal: () => ipcRenderer.invoke(COMPARE_CHANGES_REFUSAL_CHANNEL) as Promise<string | undefined>,
  listCompares: () => ipcRenderer.invoke(COMPARE_LIST_CHANNEL) as Promise<CompareListResponse>,
  updateRoomTask: (request: RoomTaskRequest) => ipcRenderer.invoke(ROOM_TASK_CHANNEL, request) as Promise<RoomTaskResponse>,
  listMemories: () => ipcRenderer.invoke(MEMORY_LIST_CHANNEL) as Promise<MemoryListResponse>,
  readRuntimeSetup: () => ipcRenderer.invoke(RUNTIME_SETUP_CHANNEL) as Promise<RuntimeSetupResponse>,
  listConnectors: () => ipcRenderer.invoke(CONNECTOR_LIST_CHANNEL) as Promise<ConnectorListResponse>,
  setTeammateConnectors: (teammateId: string, names: readonly string[]) =>
    ipcRenderer.invoke(TEAMMATE_CONNECTORS_CHANNEL, { teammateId, names }) as Promise<TeammateFolderResponse>,
  chooseTeammateFolder: (teammateId: string, clear?: boolean) =>
    ipcRenderer.invoke(TEAMMATE_FOLDER_CHANNEL, { teammateId, clear: clear === true }) as Promise<TeammateFolderResponse>,
  listWorktrees: () => ipcRenderer.invoke(WORKTREE_LIST_CHANNEL) as Promise<WorktreeListResponse>,
  readMission: (missionId: string) => ipcRenderer.invoke(MISSION_READ_CHANNEL, missionId) as Promise<MissionReadResponse>,
  removeWorktree: (teammateId: string, discard?: readonly string[]) => ipcRenderer.invoke(WORKTREE_REMOVE_CHANNEL, teammateId, discard) as Promise<WorktreeListResponse>,
  reviewBranch: (teammateId: string) => ipcRenderer.invoke(WORKTREE_REVIEW_CHANNEL, teammateId) as Promise<BranchReviewResponse>,
  turnDiff: (teammateId: string, sha: string) => ipcRenderer.invoke(WORKTREE_TURN_DIFF_CHANNEL, teammateId, sha) as Promise<TurnDiffResponse>,
  landPreview: (teammateId: string) => ipcRenderer.invoke(WORKTREE_LAND_PREVIEW_CHANNEL, teammateId) as Promise<LandPreviewResponse>,
  landBranch: (teammateId: string, message: string) => ipcRenderer.invoke(WORKTREE_LAND_CHANNEL, teammateId, message) as Promise<LandResponse>,
  startResolving: (teammateId: string) => ipcRenderer.invoke(WORKTREE_RESOLVE_CHANNEL, teammateId) as Promise<ResolveResponse>,
  addMemory: (request: MemoryAddRequest) => ipcRenderer.invoke(MEMORY_ADD_CHANNEL, request) as Promise<MemoryListResponse>,
  updateMemory: (request: MemoryUpdateRequest) => ipcRenderer.invoke(MEMORY_UPDATE_CHANNEL, request) as Promise<MemoryListResponse>,
  removeMemory: (memoryId: string) => ipcRenderer.invoke(MEMORY_REMOVE_CHANNEL, memoryId) as Promise<MemoryListResponse>,
  clearMemories: (request: MemoryClearRequest) => ipcRenderer.invoke(MEMORY_CLEAR_CHANNEL, request) as Promise<MemoryListResponse>,
  restoreMemory: (memoryId: string) => ipcRenderer.invoke(MEMORY_RESTORE_CHANNEL, memoryId) as Promise<MemoryListResponse>,
  writeWorkspaceSettings: (settings: WorkspaceSettings) =>
    ipcRenderer.invoke(WORKSPACE_SETTINGS_WRITE_CHANNEL, settings) as Promise<WorkspaceSettings>,
  decideMissionApproval: (answer: MissionApprovalAnswer) =>
    ipcRenderer.invoke(MISSION_APPROVAL_DECIDE_CHANNEL, answer) as Promise<{ readonly ok: boolean }>,
  onMissionApproval: (listener: (request: MissionApprovalRequest) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, request: MissionApprovalRequest): void => {
      listener(request)
    }
    ipcRenderer.on(MISSION_APPROVAL_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(MISSION_APPROVAL_CHANNEL, wrapped)
    }
  },
  onMissionApprovalWithdrawn: (listener: (approvalId: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, approvalId: string): void => {
      if (typeof approvalId === 'string') listener(approvalId)
    }
    ipcRenderer.on(MISSION_APPROVAL_WITHDRAWN_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(MISSION_APPROVAL_WITHDRAWN_CHANNEL, wrapped)
    }
  },
  onCodexMissionUpdate: (listener: (update: CodexMissionUpdate) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, update: CodexMissionUpdate): void => {
      listener(update)
    }
    ipcRenderer.on(CODEX_MISSION_UPDATE_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(CODEX_MISSION_UPDATE_CHANNEL, wrapped)
    }
  },
  discoveryLog: () => ipcRenderer.invoke(RUNTIME_DISCOVERY_LOG_CHANNEL) as Promise<readonly DiscoveryEvent[]>,
  splashDone: () => {
    ipcRenderer.send(SPLASH_DONE_CHANNEL)
  },
  onDiscoveryEvent: (listener: (event: DiscoveryEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, update: DiscoveryEvent): void => {
      listener(update)
    }
    ipcRenderer.on(RUNTIME_DISCOVERY_EVENT_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(RUNTIME_DISCOVERY_EVENT_CHANNEL, wrapped)
    }
  },
  recoverRoutine: (request: RoutineRecoveryRequest) => ipcRenderer.invoke(ROUTINE_RECOVERY_CHANNEL, request) as Promise<RoutineRecoveryResponse>
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
