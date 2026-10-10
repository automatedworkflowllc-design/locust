import { contextBridge, ipcRenderer } from 'electron'
import { LOCUST_MCP_GET, LOCUST_MCP_SET, LOCUST_MCP_SET_OWN_MODE } from '../shared/locust-mcp.js'
import { VOICE_READY, VOICE_DOWNLOAD, VOICE_TRANSCRIBE, VOICE_CANCEL, VOICE_PROGRESS, VOICE_SETTINGS_READ, VOICE_SETTINGS_SAVE, VOICE_OPENAI_CONSENT } from '../shared/voice.js'
import { REMOTE_CONTROL_GET_CHANNEL, REMOTE_CONTROL_SET_CHANNEL, type RemoteControlState } from '../shared/claude-remote-control.js'
import { FOLDER_CHANGES_CHANNEL, FOLDER_COMMIT_CHANNEL, type CommitResult, type FolderChanges } from '../shared/folder-commit.js'
import {
  BACKGROUND_DISMISS_CHANNEL,
  BACKGROUND_LIST_CHANNEL,
  BACKGROUND_OPEN_CHANNEL,
  BACKGROUND_SETUP_CHANNEL,
  BACKGROUND_START_CHANNEL,
  BACKGROUND_STOP_CHANNEL,
  type BackgroundStartResponse,
  type PublicBackgroundRun
} from '../shared/background.js'
import { QUEUED_MESSAGES_READ_CHANNEL, QUEUED_MESSAGES_WRITE_CHANNEL } from '../shared/queued-messages.js'
import type { QueuedMessagesResponse, SavedQueuedMessage } from '../shared/queued-messages.js'
import type { CompareSlotId } from '../shared/compare.js'
import type { UsageRange } from '../shared/usage.js'
import { CONNECTOR_ADD_CHANNEL, CONNECTOR_REMOVE_CHANNEL } from '../shared/connector-add.js'
import type { ConnectorAddRequest, ConnectorAddResponse, ConnectorAgent } from '../shared/connector-add.js'
import { GITHUB_ACCOUNT_CHANNEL, GITHUB_CLI_VERSIONS_CHANNEL, GITHUB_INSTALL_CHANNEL, GITHUB_UPDATE_CHANNEL, GITHUB_SIGN_IN_CANCEL_CHANNEL, GITHUB_SIGN_IN_CHANNEL, GITHUB_SIGN_IN_CODE_CHANNEL } from '../shared/github-account.js'
import type { GithubAccount, GithubCliVersions, GithubInstallResult, GithubSignInCode, GithubSignInResult } from '../shared/github-account.js'
import { FOLDER_PULL_REQUEST_CHANNEL } from '../shared/pull-request.js'
import type { FolderPullRequest } from '../shared/pull-request.js'
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
  AWAY_SINCE_GET_CHANNEL,
  AWAY_SINCE_CHANNEL,
  AWAY_SUMMARY_CHANNEL,
  AWAY_SEEN_CHANNEL,
  RUN_FINISHED_CHANNEL,
  ATTENTION_OPEN_MISSION_CHANNEL,
  APP_CHANGELOG_CHANNEL,
  APP_CHANGELOG_SEEN_CHANNEL,
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_LANE_CHANNEL,
  KEEP_RUNNING_GET_CHANNEL,
  KEEP_RUNNING_SET_CHANNEL,
  LOGIN_ITEM_GET_CHANNEL,
  LOGIN_ITEM_SET_CHANNEL,
  APP_UPDATE_STATE_CHANNEL,
  MISSION_PRUNE_CHANNEL,
  PROFILE_BACKUP_CHANNEL,
  PROFILE_LAST_RESTORE_CHANNEL,
  PROFILE_PICK_FOLDER_CHANNEL,
  PROFILE_RESTORE_CHANNEL,
  PROFILE_RESTORE_PREVIEW_CHANNEL,
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
  RUNTIME_SIGN_IN_CLOSED_CHANNEL,
  OPEN_IN_TERMINAL_CHANNEL,
  TERMINAL_CATCH_UP_CHANNEL,
  SESSION_IMPORT_LIST_CHANNEL,
  SESSION_IMPORT_CHANNEL,
  TEAM_CARD_SAVE_CHANNEL,
  MISSION_RECORD_SAVE_CHANNEL,
  TEAM_CARD_ADD_CHANNEL,
  RUNTIME_INSTALL_PROGRESS_CHANNEL,
  RUNTIME_UPDATES_CHANNEL,
  RUNTIME_UPDATES_EVENT_CHANNEL,
  RUNTIME_UPDATES_NOW_CHANNEL,
  TURN_UNDO_STATE_CHANNEL,
  TURN_UNDO_CHANNEL,
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
  CLOUD_WHERE_CHANNEL,
  CLOUD_START_CHANNEL,
  CLOUD_LIST_CHANNEL,
  CLOUD_REFRESH_CHANNEL,
  CLOUD_DIFF_CHANNEL,
  CLOUD_APPLY_CHANNEL,
  CLOUD_FOLDERS_CHANNEL,
  CLAUDE_CLOUD_START_CHANNEL,
  CLAUDE_CLOUD_LIST_CHANNEL,
  CLAUDE_CLOUD_HOME_CHANNEL,
  CLAUDE_CLOUD_FORGET_CHANNEL,
  CLAUDE_CLOUD_SEND_CHANNEL,
  CLAUDE_CLOUD_CHECK_CHANNEL,
  CLAUDE_CLOUD_APPLY_CHANNEL,
  CLAUDE_CLOUD_TERMINAL_CHANNEL,
  CLAUDE_CLOUD_ENVIRONMENT_CHANNEL,
  REWIND_PUT_BACK_CHANNEL,
  WORKSPACE_ATTACH_CHANNEL,
  WORKSPACE_FILES_CHANNEL,
  USAGE_READ_CHANNEL,
  PDF_PAGES_CHANNEL,
  WORKSPACE_PASTE_CHANNEL,
  WORKSPACE_IMAGE_CHANNEL,
  WORKSPACE_REVEAL_CHANNEL,
  WORKSPACE_SAVE_COPY_CHANNEL,
  WORKSPACE_TEXT_CHANNEL,
  WORKSPACE_PAGE_CHANNEL,
  REPLY_PAGE_CHANNEL,
  PAGE_PICK_CHANNEL,
  PAGE_PICK_CANCEL_CHANNEL,
  RUNTIME_COMMANDS_CHANNEL,
  DIAGNOSTICS_REVEAL_CHANNEL,
  FEEDBACK_CHANNEL,
  FEEDBACK_EMAIL_CHANNEL,
  FEEDBACK_SAVE_CHANNEL,
  DIAGNOSTICS_REPORT_CHANNEL,
  OPEN_LINK_CHANNEL,
  MAC_RELEASE_CHANNEL,
  APPROVAL_RULES_LIST_CHANNEL,
  APPROVAL_RULES_REMOVE_ALL_CHANNEL,
  APPROVAL_RULES_REMOVE_CHANNEL,
  APPROVAL_RULE_FROM_CARD_CHANNEL,
  HANDOFF_PREVIEW_CHANNEL,
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
  COMPARE_JUDGE_CHANNEL,
  COMPARE_ADD_MODEL_CHANNEL,
  COMPARE_CHANGES_CHANNEL,
  COMPARE_CHANGES_REFUSAL_CHANNEL,
  COMPARE_IN_PLACE_CHANNEL,
  COMPARE_LIST_CHANNEL,
  ROOM_TASK_CHANNEL,
  TEAMMATE_ASSIGN_CHANNEL,
  TEAMMATE_RENAME_MISSION_CHANNEL,
  TEAMMATE_PIN_MISSION_CHANNEL,
  TEAMMATE_SETTLE_MISSION_CHANNEL,
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
  ROUTINE_PAUSE_CHANNEL,
  ROUTINE_RUN_CHANNEL,
  ROUTINE_FOLDER_CHANNEL,
  ROUTINE_EXPORT_CHANNEL,
  ROUTINE_IMPORT_PREVIEW_CHANNEL,
  ROUTINE_TEMPLATE_PREVIEW_CHANNEL,
  ROUTINE_TEMPLATES_CHANNEL,
  ROUTINE_IMPORT_CHANNEL,
  ROUTINE_SETTLE_CHANNEL,
  TEAMMATE_CREATE_CHANNEL,
  TEAMMATE_LIST_CHANNEL,
  TEAMMATE_REMOVE_CHANNEL,
  TEAMMATE_UPDATE_CHANNEL,
  TEAMMATE_SPEND_CHANNEL,
  PET_LIST_CHANNEL,
  PET_SHEET_CHANNEL,
  PET_THUMBNAIL_CHANNEL,
  PET_ADD_CHANNEL,
  PET_REMOVE_CHANNEL,
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
  SKILL_LIBRARY_PREVIEW_CHANNEL,
  SKILL_LIBRARY_INSTALL_CHANNEL,
  SKILL_LIBRARY_LIST_CHANNEL,
  SKILL_LIBRARY_REMOVE_CHANNEL,
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
  ProfileBackupResponse,
  ProfileRestoreOutcome,
  ProfileRestorePreview,
  ProfileRestoreResponse,
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
  PublicCloudTask,
  PublicCloudWhere,
  PublicCloudFolder,
  PublicClaudeCloudSession,
  ClaudeCloudStartResponse,
  ClaudeCloudHomeResponse,
  ClaudeCloudReading,
  CloudStartResponse,
  CloudApplyResponse,
  RewindPutBackRequest,
  RewindPutBackResponse,
  AttachFilesResponse,
  PagePickRequest,
  PagePickResponse,
  WorkspaceFilesResponse,
  UsageReadResponse,
  PdfPagesResponse,
  OpenLinkResponse,
  MacReleaseAnswer,
  ApprovalRulesResponse,
  ApprovalRuleFromCardRequest,
  HandoffPreview,
  HandoffPreviewRequest,
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
  CompareJudgeRequest,
  CompareAddModelRequest,
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
  PetAddResponse,
  PetListResponse,
  PetRemoveResponse,
  PetSheetResponse,
  PetThumbnailResponse,
  OwnModelAddRequest,
  OwnModelListResponse,
  OwnModelMutationResponse,
  OwnModelTestRequest,
  OwnModelTestResponse,
  RoutineCreateRequest,
  RoutineListResponse,
  RoutineMutationResponse,
  RoutineRunResponse,
  RoutineFolderResponse,
  RoutineExportRequest,
  RoutineExportResponse,
  RoutineImportPreviewResponse,
  RoutineTemplatesResponse,
  RoutineImportRequest,
  RoutineSettleRequest,
  RoutineSettleResponse,
  RoutineUpdateRequest,
  MemoryAddRequest,
  MemoryClearRequest,
  MemoryListResponse,
  MemoryUpdateRequest,
  SkillLibraryInstallRequest,
  SkillLibraryListResponse,
  SkillLibraryPreviewResponse,
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
  KeepRunningState,
  LoginItemState,
  RuntimeUpdatesState,
  TurnUndoState,
  RuntimeInstallResponse,
  RuntimeSignInResponse,
  OpenInTerminalResponse,
  TerminalCatchUpResponse,
  SessionImportListResponse,
  SessionImportResponse,
  TeamCardRect,
  MissionRecordSaveRequest,
  MissionRecordSaveResponse,
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
  locustMcp: {
    settings: () => ipcRenderer.invoke(LOCUST_MCP_GET),
    setEnabled: (enabled) => ipcRenderer.invoke(LOCUST_MCP_SET, enabled),
    setOwnMode: (ownMode) => ipcRenderer.invoke(LOCUST_MCP_SET_OWN_MODE, ownMode)
  },
  voice: {
    settings: () => ipcRenderer.invoke(VOICE_SETTINGS_READ),
    saveSettings: (change) => ipcRenderer.invoke(VOICE_SETTINGS_SAVE, change),
    allowOpenAI: () => ipcRenderer.invoke(VOICE_OPENAI_CONSENT),
    ready: (mode) => ipcRenderer.invoke(VOICE_READY, mode),
    download: (mode) => ipcRenderer.invoke(VOICE_DOWNLOAD, mode),
    transcribe: (wav, mode) => ipcRenderer.invoke(VOICE_TRANSCRIBE, wav, mode),
    cancel: () => ipcRenderer.invoke(VOICE_CANCEL),
    onProgress: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, percent: number): void => { listener(percent) }
      ipcRenderer.on(VOICE_PROGRESS, receive)
      return () => { ipcRenderer.removeListener(VOICE_PROGRESS, receive) }
    }
  },
  platform: process.platform,
  setNeedsYouCount: (count) => ipcRenderer.send(NEEDS_YOU_COUNT_CHANNEL, count),
  getAwaySince: () => ipcRenderer.invoke(AWAY_SINCE_GET_CHANNEL) as Promise<{ readonly since?: string }>,
  onAwaySince: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { readonly since?: unknown }): void => {
      if (typeof payload?.since === 'string') listener(payload.since)
    }
    ipcRenderer.on(AWAY_SINCE_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(AWAY_SINCE_CHANNEL, wrapped)
    }
  },
  setAwaySummary: (counts) => ipcRenderer.send(AWAY_SUMMARY_CHANNEL, counts),
  awaySeen: () => ipcRenderer.send(AWAY_SEEN_CHANNEL),
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
  readLoginItem: () => ipcRenderer.invoke(LOGIN_ITEM_GET_CHANNEL) as Promise<LoginItemState>,
  setLoginItem: (openAtLogin: boolean) => ipcRenderer.invoke(LOGIN_ITEM_SET_CHANNEL, openAtLogin === true) as Promise<LoginItemState>,
  readKeepRunning: () => ipcRenderer.invoke(KEEP_RUNNING_GET_CHANNEL) as Promise<KeepRunningState>,
  setKeepRunning: (keepRunning: boolean) => ipcRenderer.invoke(KEEP_RUNNING_SET_CHANNEL, keepRunning === true) as Promise<KeepRunningState>,
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
  pickProfileFolder: (purpose: 'backup' | 'restore') =>
    ipcRenderer.invoke(PROFILE_PICK_FOLDER_CHANNEL, purpose) as Promise<string | undefined>,
  backupProfile: (folder: string) => ipcRenderer.invoke(PROFILE_BACKUP_CHANNEL, folder) as Promise<ProfileBackupResponse>,
  previewProfileRestore: (folder: string) => ipcRenderer.invoke(PROFILE_RESTORE_PREVIEW_CHANNEL, folder) as Promise<ProfileRestorePreview>,
  restoreProfile: (folder: string) => ipcRenderer.invoke(PROFILE_RESTORE_CHANNEL, folder) as Promise<ProfileRestoreResponse>,
  takeLastProfileRestore: () => ipcRenderer.invoke(PROFILE_LAST_RESTORE_CHANNEL) as Promise<ProfileRestoreOutcome | undefined>,
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
  listPets: () => ipcRenderer.invoke(PET_LIST_CHANNEL) as Promise<PetListResponse>,
  readPetSheet: (source: string, id: string) => ipcRenderer.invoke(PET_SHEET_CHANNEL, source, id) as Promise<PetSheetResponse>,
  petThumbnail: (id: string) => ipcRenderer.invoke(PET_THUMBNAIL_CHANNEL, id) as Promise<PetThumbnailResponse>,
  addPet: (id: string) => ipcRenderer.invoke(PET_ADD_CHANNEL, id) as Promise<PetAddResponse>,
  removePet: (id: string) => ipcRenderer.invoke(PET_REMOVE_CHANNEL, id) as Promise<PetRemoveResponse>,
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
  pinMission: (missionId: string, pinned: boolean) =>
    ipcRenderer.invoke(TEAMMATE_PIN_MISSION_CHANNEL, { missionId, pinned }) as Promise<TeammateMutationResponse>,
  settleMission: (missionId: string, settled: { readonly until?: string } | undefined) =>
    ipcRenderer.invoke(TEAMMATE_SETTLE_MISSION_CHANNEL, { missionId, ...(settled === undefined ? { back: true } : settled) }) as Promise<TeammateMutationResponse>,
  readQueuedMessages: () => ipcRenderer.invoke(QUEUED_MESSAGES_READ_CHANNEL) as Promise<QueuedMessagesResponse>,
  writeQueuedMessages: (rows: readonly SavedQueuedMessage[]) => ipcRenderer.invoke(QUEUED_MESSAGES_WRITE_CHANNEL, rows) as Promise<QueuedMessagesResponse>,
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
  pauseRoutine: (routineId: string, paused: boolean) =>
    ipcRenderer.invoke(ROUTINE_PAUSE_CHANNEL, routineId, paused) as Promise<RoutineMutationResponse>,
  runRoutine: (routineId: string, values?: Readonly<Record<string, string>>) => ipcRenderer.invoke(ROUTINE_RUN_CHANNEL, routineId, values) as Promise<RoutineRunResponse>,
  chooseRoutineFolder: () => ipcRenderer.invoke(ROUTINE_FOLDER_CHANNEL) as Promise<RoutineFolderResponse>,
  exportRoutine: (request: RoutineExportRequest) => ipcRenderer.invoke(ROUTINE_EXPORT_CHANNEL, request) as Promise<RoutineExportResponse>,
  previewRoutineImport: () => ipcRenderer.invoke(ROUTINE_IMPORT_PREVIEW_CHANNEL) as Promise<RoutineImportPreviewResponse>,
  listRoutineTemplates: () => ipcRenderer.invoke(ROUTINE_TEMPLATES_CHANNEL) as Promise<RoutineTemplatesResponse>,
  previewRoutineTemplate: (id: string) => ipcRenderer.invoke(ROUTINE_TEMPLATE_PREVIEW_CHANNEL, id) as Promise<RoutineImportPreviewResponse>,
  importRoutine: (request: RoutineImportRequest) => ipcRenderer.invoke(ROUTINE_IMPORT_CHANNEL, request) as Promise<RoutineMutationResponse>,
  settleRoutine: (request: RoutineSettleRequest) => ipcRenderer.invoke(ROUTINE_SETTLE_CHANNEL, request) as Promise<RoutineSettleResponse>,
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
  signInRuntime: (runtime: string, again?: boolean) =>
    ipcRenderer.invoke(RUNTIME_SIGN_IN_CHANNEL, runtime, again === true) as Promise<RuntimeSignInResponse>,
  onSignInClosed: (listener: (runtime: string) => void) => {
    const handler = (_event: unknown, runtime: string): void => listener(runtime)
    ipcRenderer.on(RUNTIME_SIGN_IN_CLOSED_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(RUNTIME_SIGN_IN_CLOSED_CHANNEL, handler)
    }
  },
  openInTerminal: (missionId: string) =>
    ipcRenderer.invoke(OPEN_IN_TERMINAL_CHANNEL, missionId) as Promise<OpenInTerminalResponse>,
  catchUpTerminal: (missionId: string) =>
    ipcRenderer.invoke(TERMINAL_CATCH_UP_CHANNEL, missionId) as Promise<TerminalCatchUpResponse>,
  listImportableSessions: () => ipcRenderer.invoke(SESSION_IMPORT_LIST_CHANNEL) as Promise<SessionImportListResponse>,
  importSession: (runtime: 'claude' | 'codex', sessionId: string) =>
    ipcRenderer.invoke(SESSION_IMPORT_CHANNEL, { runtime, sessionId }) as Promise<SessionImportResponse>,
  saveMissionRecord: (request: MissionRecordSaveRequest) => ipcRenderer.invoke(MISSION_RECORD_SAVE_CHANNEL, request) as Promise<MissionRecordSaveResponse>,
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
  turnUndoStates: (runIds: readonly string[]) =>
    ipcRenderer.invoke(TURN_UNDO_STATE_CHANNEL, [...runIds]) as Promise<Readonly<Record<string, TurnUndoState>>>,
  undoTurn: (runId: string) => ipcRenderer.invoke(TURN_UNDO_CHANNEL, runId) as Promise<TurnUndoState>,
  folderChanges: () => ipcRenderer.invoke(FOLDER_CHANGES_CHANNEL) as Promise<FolderChanges>,
  folderPullRequest: () => ipcRenderer.invoke(FOLDER_PULL_REQUEST_CHANNEL) as Promise<FolderPullRequest | undefined>,
  commitFolder: (message, then, shown) => ipcRenderer.invoke(FOLDER_COMMIT_CHANNEL, message, then, [...shown]) as Promise<CommitResult>,
  backgroundRuns: () => ipcRenderer.invoke(BACKGROUND_LIST_CHANNEL) as Promise<readonly PublicBackgroundRun[]>,
  startBackground: (request) => ipcRenderer.invoke(BACKGROUND_START_CHANNEL, request) as Promise<BackgroundStartResponse>,
  stopBackground: (id) => ipcRenderer.invoke(BACKGROUND_STOP_CHANNEL, id) as Promise<boolean>,
  openBackground: (id) => ipcRenderer.invoke(BACKGROUND_OPEN_CHANNEL, id) as Promise<{ readonly ok: boolean; readonly message?: string }>,
  setUpBackground: () => ipcRenderer.invoke(BACKGROUND_SETUP_CHANNEL) as Promise<{ readonly ok: boolean; readonly message?: string }>,
  dismissBackground: (id) => ipcRenderer.invoke(BACKGROUND_DISMISS_CHANNEL, id) as Promise<void>,
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
  cloudWhere: () => ipcRenderer.invoke(CLOUD_WHERE_CHANNEL) as Promise<PublicCloudWhere>,
  startCloudTask: (prompt: string, teammateId?: string) => ipcRenderer.invoke(CLOUD_START_CHANNEL, prompt, teammateId) as Promise<CloudStartResponse>,
  listCloudTasks: () => ipcRenderer.invoke(CLOUD_LIST_CHANNEL) as Promise<readonly PublicCloudTask[]>,
  refreshCloudTask: (taskId: string) => ipcRenderer.invoke(CLOUD_REFRESH_CHANNEL, taskId) as Promise<PublicCloudTask | undefined>,
  cloudTaskDiff: (taskId: string) => ipcRenderer.invoke(CLOUD_DIFF_CHANNEL, taskId) as Promise<string | undefined>,
  applyCloudTask: (taskId: string) => ipcRenderer.invoke(CLOUD_APPLY_CHANNEL, taskId) as Promise<CloudApplyResponse>,
  cloudFolders: () => ipcRenderer.invoke(CLOUD_FOLDERS_CHANNEL) as Promise<readonly PublicCloudFolder[]>,
  getRemoteControl: () => ipcRenderer.invoke(REMOTE_CONTROL_GET_CHANNEL) as Promise<RemoteControlState>,
  setRemoteControl: (enabled: boolean) => ipcRenderer.invoke(REMOTE_CONTROL_SET_CHANNEL, enabled) as Promise<RemoteControlState>,
  startClaudeCloud: (prompt: string, teammateId?: string, choice?: { readonly model?: string; readonly effort?: string; readonly environment?: string }) => ipcRenderer.invoke(CLAUDE_CLOUD_START_CHANNEL, prompt, teammateId, choice) as Promise<ClaudeCloudStartResponse>,
  getClaudeCloudEnvironment: () => ipcRenderer.invoke(CLAUDE_CLOUD_ENVIRONMENT_CHANNEL) as Promise<string | undefined>,
  listClaudeCloud: () => ipcRenderer.invoke(CLAUDE_CLOUD_LIST_CHANNEL) as Promise<readonly PublicClaudeCloudSession[]>,
  bringClaudeCloudHome: (id: string) => ipcRenderer.invoke(CLAUDE_CLOUD_HOME_CHANNEL, id) as Promise<ClaudeCloudHomeResponse>,
  continueClaudeCloudInTerminal: (id: string) => ipcRenderer.invoke(CLAUDE_CLOUD_TERMINAL_CHANNEL, id) as Promise<OpenInTerminalResponse>,
  forgetClaudeCloud: (id: string) => ipcRenderer.invoke(CLAUDE_CLOUD_FORGET_CHANNEL, id) as Promise<void>,
  sendClaudeCloud: (id: string, message: string) => ipcRenderer.invoke(CLAUDE_CLOUD_SEND_CHANNEL, id, message) as Promise<ClaudeCloudHomeResponse>,
  checkClaudeCloud: (id: string) => ipcRenderer.invoke(CLAUDE_CLOUD_CHECK_CHANNEL, id) as Promise<ClaudeCloudReading>,
  applyClaudeCloud: (id: string) => ipcRenderer.invoke(CLAUDE_CLOUD_APPLY_CHANNEL, id) as Promise<ClaudeCloudHomeResponse>,
  putBackFiles: (request: RewindPutBackRequest) => ipcRenderer.invoke(REWIND_PUT_BACK_CHANNEL, request) as Promise<RewindPutBackResponse>,
  revealFile: (path: string) => ipcRenderer.invoke(WORKSPACE_REVEAL_CHANNEL, path) as Promise<RevealFileResponse>,
  saveCopy: (path: string) => ipcRenderer.invoke(WORKSPACE_SAVE_COPY_CHANNEL, path) as Promise<RevealFileResponse>,
  readTextFile: (path: string) => ipcRenderer.invoke(WORKSPACE_TEXT_CHANNEL, path) as Promise<WorkspaceTextResponse>,
  pageUrlFor: (path: string, column?: { readonly compareId: string; readonly slot: string }) => ipcRenderer.invoke(WORKSPACE_PAGE_CHANNEL, path, column) as Promise<WorkspacePageResponse>,
  replyPageUrl: (html: string) => ipcRenderer.invoke(REPLY_PAGE_CHANNEL, html) as Promise<WorkspacePageResponse>,
  runtimeCommands: () => ipcRenderer.invoke(RUNTIME_COMMANDS_CHANNEL) as Promise<RuntimeCommandsResponse>,
  revealDiagnostics: () => ipcRenderer.invoke(DIAGNOSTICS_REVEAL_CHANNEL) as Promise<void>,
  sendFeedback: (report: FeedbackReport) => ipcRenderer.invoke(FEEDBACK_CHANNEL, report) as Promise<OpenLinkResponse>,
  emailFeedback: (report: FeedbackReport) => ipcRenderer.invoke(FEEDBACK_EMAIL_CHANNEL, report) as Promise<OpenLinkResponse>,
  saveFeedbackFile: (report: FeedbackReport) => ipcRenderer.invoke(FEEDBACK_SAVE_CHANNEL, report) as Promise<{ readonly ok: boolean; readonly path?: string; readonly message?: string }>,
  diagnosticsReport: () => ipcRenderer.invoke(DIAGNOSTICS_REPORT_CHANNEL) as Promise<DiagnosticsReport>,
  openLink: (url: string) => ipcRenderer.invoke(OPEN_LINK_CHANNEL, url) as Promise<OpenLinkResponse>,
  macRelease: () => ipcRenderer.invoke(MAC_RELEASE_CHANNEL) as Promise<MacReleaseAnswer | undefined>,
  previewHandoff: (request: HandoffPreviewRequest) => ipcRenderer.invoke(HANDOFF_PREVIEW_CHANNEL, request) as Promise<HandoffPreview | undefined>,
  readWorkspaceImage: (path: string, folder?: string) =>
    ipcRenderer.invoke(WORKSPACE_IMAGE_CHANNEL, path, folder) as Promise<WorkspaceImageResponse>,
  attachFiles: () => ipcRenderer.invoke(WORKSPACE_ATTACH_CHANNEL) as Promise<AttachFilesResponse>,
  workspaceFiles: () => ipcRenderer.invoke(WORKSPACE_FILES_CHANNEL) as Promise<WorkspaceFilesResponse>,
  readUsage: (range: UsageRange) => ipcRenderer.invoke(USAGE_READ_CHANNEL, range) as Promise<UsageReadResponse>,
  pdfPages: (path: string, folder?: string) => ipcRenderer.invoke(PDF_PAGES_CHANNEL, path, folder) as Promise<PdfPagesResponse>,
  addConnector: (request: ConnectorAddRequest) => ipcRenderer.invoke(CONNECTOR_ADD_CHANNEL, request) as Promise<ConnectorAddResponse>,
  removeConnector: (name: string, agents: readonly ConnectorAgent[]) => ipcRenderer.invoke(CONNECTOR_REMOVE_CHANNEL, name, agents) as Promise<ConnectorAddResponse>,
  githubAccount: () => ipcRenderer.invoke(GITHUB_ACCOUNT_CHANNEL) as Promise<GithubAccount>,
  githubSignIn: () => ipcRenderer.invoke(GITHUB_SIGN_IN_CHANNEL) as Promise<GithubSignInResult>,
  githubSignInCancel: () => ipcRenderer.invoke(GITHUB_SIGN_IN_CANCEL_CHANNEL) as Promise<void>,
  githubInstall: () => ipcRenderer.invoke(GITHUB_INSTALL_CHANNEL) as Promise<GithubInstallResult>,
  githubUpdate: () => ipcRenderer.invoke(GITHUB_UPDATE_CHANNEL) as Promise<GithubInstallResult>,
  githubCliVersions: () => ipcRenderer.invoke(GITHUB_CLI_VERSIONS_CHANNEL) as Promise<GithubCliVersions>,
  onGithubSignInCode: (listener: (code: GithubSignInCode) => void) => {
    const handler = (_event: unknown, code: GithubSignInCode): void => listener(code)
    ipcRenderer.on(GITHUB_SIGN_IN_CODE_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(GITHUB_SIGN_IN_CODE_CHANNEL, handler)
    }
  },
  attachPasted: (name: string, bytes: Uint8Array) =>
    ipcRenderer.invoke(WORKSPACE_PASTE_CHANNEL, { name, bytes }) as Promise<AttachFilesResponse>,
  pickInPage: (request: PagePickRequest) => ipcRenderer.invoke(PAGE_PICK_CHANNEL, request) as Promise<PagePickResponse>,
  cancelPagePick: (pageUrl: string) => ipcRenderer.invoke(PAGE_PICK_CANCEL_CHANNEL, pageUrl) as Promise<void>,
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
  judgeCompare: (request: CompareJudgeRequest) => ipcRenderer.invoke(COMPARE_JUDGE_CHANNEL, request) as Promise<CompareResponse>,
  addCompareModel: (request: CompareAddModelRequest) => ipcRenderer.invoke(COMPARE_ADD_MODEL_CHANNEL, request) as Promise<CompareResponse>,
  compareChanges: (compareId: string) => ipcRenderer.invoke(COMPARE_CHANGES_CHANNEL, compareId) as Promise<CompareChangesResponse>,
  compareChangesRefusal: () => ipcRenderer.invoke(COMPARE_CHANGES_REFUSAL_CHANNEL) as Promise<string | undefined>,
  compareWorksInPlace: () => ipcRenderer.invoke(COMPARE_IN_PLACE_CHANNEL) as Promise<boolean>,
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
  previewSkillLibrary: (link: string) => ipcRenderer.invoke(SKILL_LIBRARY_PREVIEW_CHANNEL, link) as Promise<SkillLibraryPreviewResponse>,
  installSkillLibrary: (request: SkillLibraryInstallRequest) =>
    ipcRenderer.invoke(SKILL_LIBRARY_INSTALL_CHANNEL, request) as Promise<SkillLibraryListResponse>,
  listSkillLibrary: () => ipcRenderer.invoke(SKILL_LIBRARY_LIST_CHANNEL) as Promise<SkillLibraryListResponse>,
  removeSkillLibrary: (source: string) => ipcRenderer.invoke(SKILL_LIBRARY_REMOVE_CHANNEL, source) as Promise<SkillLibraryListResponse>,
  writeWorkspaceSettings: (settings: WorkspaceSettings) =>
    ipcRenderer.invoke(WORKSPACE_SETTINGS_WRITE_CHANNEL, settings) as Promise<WorkspaceSettings>,
  listApprovalRules: () => ipcRenderer.invoke(APPROVAL_RULES_LIST_CHANNEL) as Promise<ApprovalRulesResponse>,
  removeApprovalRule: (ruleId: string) => ipcRenderer.invoke(APPROVAL_RULES_REMOVE_CHANNEL, ruleId) as Promise<ApprovalRulesResponse>,
  removeAllApprovalRules: () => ipcRenderer.invoke(APPROVAL_RULES_REMOVE_ALL_CHANNEL) as Promise<ApprovalRulesResponse>,
  ruleFromApprovalCard: (request: ApprovalRuleFromCardRequest) => ipcRenderer.invoke(APPROVAL_RULE_FROM_CARD_CHANNEL, request) as Promise<ApprovalRulesResponse>,
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
