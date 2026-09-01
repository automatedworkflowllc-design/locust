import { contextBridge, ipcRenderer } from 'electron'
import {
  CODEX_MISSION_CANCEL_CHANNEL,
  CODEX_MISSION_START_CHANNEL,
  CODEX_MISSION_UPDATE_CHANNEL,
  MISSION_APPROVAL_CHANNEL,
  MISSION_APPROVAL_DECIDE_CHANNEL,
  MISSION_HISTORY_CHANNEL,
  MODEL_CATALOG_CHANNEL,
  RUNTIME_DISCOVERY_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL
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
  MissionHistoryResponse,
  ModelCatalogResponse,
  RuntimeDiscoveryResponse,
  TeammateCreateRequest,
  TeammateListResponse,
  TeammateMutationResponse
} from '../shared/ipc.js'

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
  PublicModel,
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
  getLocalRuntimes: () => ipcRenderer.invoke(RUNTIME_DISCOVERY_CHANNEL) as Promise<RuntimeDiscoveryResponse>,
  getMissionHistory: () => ipcRenderer.invoke(MISSION_HISTORY_CHANNEL) as Promise<MissionHistoryResponse>,
  listTeammates: () => ipcRenderer.invoke(TEAMMATE_LIST_CHANNEL) as Promise<TeammateListResponse>,
  createTeammate: (request: TeammateCreateRequest) =>
    ipcRenderer.invoke(TEAMMATE_CREATE_CHANNEL, request) as Promise<TeammateMutationResponse>,
  removeTeammate: (teammateId: string) =>
    ipcRenderer.invoke(TEAMMATE_REMOVE_CHANNEL, teammateId) as Promise<TeammateMutationResponse>,
  assignMission: (teammateId: string, missionId: string) =>
    ipcRenderer.invoke(TEAMMATE_ASSIGN_CHANNEL, { teammateId, missionId }) as Promise<TeammateMutationResponse>,
  startCodexMission: (request: CodexMissionStartRequest) =>
    ipcRenderer.invoke(CODEX_MISSION_START_CHANNEL, request) as Promise<CodexMissionStartResponse>,
  cancelCodexMission: (request: CodexMissionCancelRequest) =>
    ipcRenderer.invoke(CODEX_MISSION_CANCEL_CHANNEL, request) as Promise<CodexMissionCancelResponse>,
  listModels: () => ipcRenderer.invoke(MODEL_CATALOG_CHANNEL) as Promise<ModelCatalogResponse>,
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
  }
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
