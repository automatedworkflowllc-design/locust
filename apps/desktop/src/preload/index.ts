import { contextBridge, ipcRenderer } from 'electron'
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
  MISSION_PRUNE_CHANNEL,
  MISSION_STORAGE_CHANNEL,
  MISSION_DELETE_CHANNEL,
  MISSION_HISTORY_CHANNEL,
  MODEL_CATALOG_CHANNEL,
  RUNTIME_ARTIFACTS_CHANNEL,
  RUNTIME_INSTALL_CHANNEL,
  RUNTIME_INSTALL_PROGRESS_CHANNEL,
  RUNTIME_DISCOVERY_CHANNEL,
  WORKSPACE_SETTINGS_READ_CHANNEL,
  WORKSPACE_SETTINGS_WRITE_CHANNEL,
  WORKSPACE_CHOOSE_CHANNEL,
  WORKSPACE_ATTACH_CHANNEL,
  WORKSPACE_IMAGE_CHANNEL,
  WORKSPACE_REVEAL_CHANNEL,
  OPEN_LINK_CHANNEL,
  ROOM_LIST_CHANNEL,
  ROOM_CREATE_CHANNEL,
  ROOM_REMOVE_CHANNEL,
  ROOM_POST_CHANNEL,
  ROOM_TASK_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  ROUTINE_LIST_CHANNEL,
  ROUTINE_CREATE_CHANNEL,
  ROUTINE_UPDATE_CHANNEL,
  ROUTINE_REMOVE_CHANNEL,
  ROUTINE_RUN_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL,
  TEAMMATE_UPDATE_CHANNEL,
  MEMORY_LIST_CHANNEL,
  MEMORY_ADD_CHANNEL,
  MEMORY_UPDATE_CHANNEL,
  MEMORY_REMOVE_CHANNEL,
  MEMORY_CLEAR_CHANNEL,
  RUNTIME_SETUP_CHANNEL,
  WORKTREE_LIST_CHANNEL,
  WORKTREE_REMOVE_CHANNEL
} from '../shared/ipc.js'
import type {
  CodexMissionCancelRequest,
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
  AppUpdateResponse,
  AppUpdateState,
  MissionPruneRequest,
  MissionPruneResponse,
  StorageReportResponse,
  MissionDeleteResponse,
  MissionHistoryResponse,
  ModelCatalogResponse,
  PublicRuntimeArtifact,
  RuntimeDiscoveryResponse,
  WorkspaceSettings,
  WorkspaceChooseResponse,
  AttachFilesResponse,
  OpenLinkResponse,
  RevealFileResponse,
  WorkspaceImageResponse,
  RoomListResponse,
  RoomMutationResponse,
  RoomPostResponse,
  RoomCreateRequest,
  RoomPostRequest,
  RoomTaskRequest,
  RoomTaskResponse,
  TeammateCreateRequest,
  TeammateListResponse,
  TeammateMutationResponse,
  TeammateUpdateRequest,
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
  WorktreeListResponse,
  RuntimeInstallProgress,
  RuntimeInstallResponse
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
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
  readStorageReport: () => ipcRenderer.invoke(MISSION_STORAGE_CHANNEL) as Promise<StorageReportResponse>,
  checkForUpdate: () => ipcRenderer.invoke(APP_UPDATE_CHECK_CHANNEL) as Promise<AppUpdateResponse>,
  installUpdate: () => ipcRenderer.invoke(APP_UPDATE_INSTALL_CHANNEL) as Promise<AppUpdateResponse>,
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
  getLocalRuntimes: () => ipcRenderer.invoke(RUNTIME_DISCOVERY_CHANNEL) as Promise<RuntimeDiscoveryResponse>,
  getMissionHistory: () => ipcRenderer.invoke(MISSION_HISTORY_CHANNEL) as Promise<MissionHistoryResponse>,
  deleteMission: (missionId: string) =>
    ipcRenderer.invoke(MISSION_DELETE_CHANNEL, missionId) as Promise<MissionDeleteResponse>,
  listTeammates: () => ipcRenderer.invoke(TEAMMATE_LIST_CHANNEL) as Promise<TeammateListResponse>,
  createTeammate: (request: TeammateCreateRequest) =>
    ipcRenderer.invoke(TEAMMATE_CREATE_CHANNEL, request) as Promise<TeammateMutationResponse>,
  removeTeammate: (teammateId: string) =>
    ipcRenderer.invoke(TEAMMATE_REMOVE_CHANNEL, teammateId) as Promise<TeammateMutationResponse>,
  updateTeammate: (request: TeammateUpdateRequest) =>
    ipcRenderer.invoke(TEAMMATE_UPDATE_CHANNEL, request) as Promise<TeammateMutationResponse>,
  assignMission: (teammateId: string, missionId: string) =>
    ipcRenderer.invoke(TEAMMATE_ASSIGN_CHANNEL, { teammateId, missionId }) as Promise<TeammateMutationResponse>,
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
  onRuntimeInstallProgress: (listener: (progress: RuntimeInstallProgress) => void) => {
    const handler = (_event: unknown, progress: RuntimeInstallProgress): void => listener(progress)
    ipcRenderer.on(RUNTIME_INSTALL_PROGRESS_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(RUNTIME_INSTALL_PROGRESS_CHANNEL, handler)
    }
  },
  readWorkspaceSettings: () =>
    ipcRenderer.invoke(WORKSPACE_SETTINGS_READ_CHANNEL) as Promise<WorkspaceSettings>,
  chooseWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHOOSE_CHANNEL) as Promise<WorkspaceChooseResponse>,
  revealFile: (path: string) => ipcRenderer.invoke(WORKSPACE_REVEAL_CHANNEL, path) as Promise<RevealFileResponse>,
  openLink: (url: string) => ipcRenderer.invoke(OPEN_LINK_CHANNEL, url) as Promise<OpenLinkResponse>,
  readWorkspaceImage: (path: string) =>
    ipcRenderer.invoke(WORKSPACE_IMAGE_CHANNEL, path) as Promise<WorkspaceImageResponse>,
  attachFiles: () => ipcRenderer.invoke(WORKSPACE_ATTACH_CHANNEL) as Promise<AttachFilesResponse>,
  listRooms: () => ipcRenderer.invoke(ROOM_LIST_CHANNEL) as Promise<RoomListResponse>,
  createRoom: (request: RoomCreateRequest) => ipcRenderer.invoke(ROOM_CREATE_CHANNEL, request) as Promise<RoomMutationResponse>,
  removeRoom: (roomId: string) => ipcRenderer.invoke(ROOM_REMOVE_CHANNEL, roomId) as Promise<RoomMutationResponse>,
  postToRoom: (request: RoomPostRequest) => ipcRenderer.invoke(ROOM_POST_CHANNEL, request) as Promise<RoomPostResponse>,
  updateRoomTask: (request: RoomTaskRequest) => ipcRenderer.invoke(ROOM_TASK_CHANNEL, request) as Promise<RoomTaskResponse>,
  listMemories: () => ipcRenderer.invoke(MEMORY_LIST_CHANNEL) as Promise<MemoryListResponse>,
  readRuntimeSetup: () => ipcRenderer.invoke(RUNTIME_SETUP_CHANNEL) as Promise<RuntimeSetupResponse>,
  listWorktrees: () => ipcRenderer.invoke(WORKTREE_LIST_CHANNEL) as Promise<WorktreeListResponse>,
  removeWorktree: (teammateId: string) => ipcRenderer.invoke(WORKTREE_REMOVE_CHANNEL, teammateId) as Promise<WorktreeListResponse>,
  addMemory: (request: MemoryAddRequest) => ipcRenderer.invoke(MEMORY_ADD_CHANNEL, request) as Promise<MemoryListResponse>,
  updateMemory: (request: MemoryUpdateRequest) => ipcRenderer.invoke(MEMORY_UPDATE_CHANNEL, request) as Promise<MemoryListResponse>,
  removeMemory: (memoryId: string) => ipcRenderer.invoke(MEMORY_REMOVE_CHANNEL, memoryId) as Promise<MemoryListResponse>,
  clearMemories: (request: MemoryClearRequest) => ipcRenderer.invoke(MEMORY_CLEAR_CHANNEL, request) as Promise<MemoryListResponse>,
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
  onCodexMissionUpdate: (listener: (update: CodexMissionUpdate) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, update: CodexMissionUpdate): void => {
      listener(update)
    }
    ipcRenderer.on(CODEX_MISSION_UPDATE_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(CODEX_MISSION_UPDATE_CHANNEL, wrapped)
    }
  },
  recoverRoutine: (request: RoutineRecoveryRequest) => ipcRenderer.invoke(ROUTINE_RECOVERY_CHANNEL, request) as Promise<RoutineRecoveryResponse>
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
