import type { MissionStarter } from '@teammate/mission-store'
import type { CodexMissionStartRequest, CodexMissionStartResponse, MissionMode, MissionReadResponse, TeammateListResponse } from '../shared/ipc.js'
import type { PublicBackgroundRun } from '../shared/background.js'
import { joinMessageFragments } from '../shared/messageFragments.js'
import { unwrapProtocolTags } from '../shared/protocolTags.js'
import { mcpText, type McpToolResult } from './locust-mcp-host.js'

/** Only adapters to the window's existing roster, start and ledger readers. */
export function createLocustMcpTools(options: {
  readonly teammates: () => Promise<TeammateListResponse>
  readonly busy: (teammateId: string) => boolean
  readonly start: (request: CodexMissionStartRequest, origin: MissionStarter) => Promise<CodexMissionStartResponse>
  readonly read: (missionId: string) => Promise<MissionReadResponse>
  readonly newest: (missionId: string) => Promise<string>
  readonly owner: (missionId: string) => Promise<string | undefined>
  readonly live: (missionId: string) => boolean
  readonly background: () => Promise<readonly PublicBackgroundRun[]>
  /** The person's switch in Settings: the teammate's own mode instead of Ask. Read on every turn. */
  readonly ownMode?: () => boolean
  /** A card of this turn is waiting in Locust's window. */
  readonly waiting?: (missionId: string) => boolean
}) {
  const starting = new Set<string>()
  const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
  const lookup = async (id: string) => {
    const root = await options.read(id)
    if (!root.ok || root.data.mission.startedBy?.kind !== 'mcp') return undefined
    const newest = await options.newest(id)
    const read = newest === id ? root : await options.read(newest)
    return read.ok ? read.data.mission : undefined
  }
  /*
   * Ask unless the person turned on "each teammate's own mode" (0.703); then
   * the mode saved on the teammate in Locust -- never one the other app names.
   * Auto is still refused on the host's one path unless Settings allows it,
   * and approval cards still go only to Locust's window.
   */
  const modeOf = async (teammateId: string): Promise<MissionMode> => {
    if (options.ownMode?.() !== true) return 'ask'
    const list = await options.teammates()
    return (list.ok ? list.data.teammates.find(t => t.teammateId === teammateId)?.route?.mode : undefined) ?? 'ask'
  }
  const started = async (request: Pick<CodexMissionStartRequest, 'prompt' | 'teammateId' | 'followUpOf'>, conversation?: string): Promise<McpToolResult> => {
    // This is the only request shape that can reach the start path. A tool
    // argument named mode/route/etc. never widens it or changes a saved route.
    const mode = await modeOf(request.teammateId!)
    const result = await options.start({ ...request, mode, keepSavedRoute: true } as CodexMissionStartRequest, { kind: 'mcp' })
    return result.ok ? mcpText(JSON.stringify({ conversation_id: conversation ?? result.data.missionId, mode })) : mcpText(result.error.message, true)
  }
  return async (name: string, arguments_: unknown): Promise<McpToolResult> => {
    const args = typeof arguments_ === 'object' && arguments_ !== null && !Array.isArray(arguments_) ? arguments_ as Record<string, unknown> : {}
    if (name === 'list_teammates') {
      const list = await options.teammates()
      if (!list.ok) return mcpText(list.error.message, true)
      const own = options.ownMode?.() === true
      return mcpText(JSON.stringify(list.data.teammates.map(t => ({ id: t.teammateId, name: t.name, role: t.roleTitle ?? t.role,
        runtime: t.route?.runtime ?? null, model: t.route?.model ?? null, busy: options.busy(t.teammateId),
        // What a turn started from here would use, so the other app is never surprised by an edit.
        runs_in: own ? t.route?.mode ?? 'ask' : 'ask' }))))
    }
    if (name === 'list_background_runs') return mcpText(JSON.stringify(await options.background()))
    if (name === 'start_conversation') {
      if (!text(args.teammate) || !text(args.message, 8_000)) return mcpText('Choose a teammate and give it a message of up to 8,000 characters. Nothing was started.', true)
      const list = await options.teammates()
      if (!list.ok) return mcpText(list.error.message, true)
      const matches = list.data.teammates.filter(t => t.teammateId === args.teammate || t.name.toLowerCase() === (args.teammate as string).toLowerCase())
      if (matches.length !== 1) return mcpText('That teammate could not be identified. Use its id from list_teammates. Nothing was started.', true)
      return started({ prompt: args.message, teammateId: matches[0]!.teammateId })
    }
    if (name === 'send_message' || name === 'read_reply') {
      if (!text(args.conversation_id)) return mcpText('Give a conversation id returned by start_conversation.', true)
      const id = args.conversation_id
      if (starting.has(id)) return mcpText('Still working: starting the next turn.')
      // Claim before the first read: concurrent sends must not both resume
      // the same old tip, even if the first finishes while the second reads.
      if (name === 'send_message') starting.add(id)
      try {
        const mission = await lookup(id)
        if (mission === undefined) return mcpText('That conversation could not be read from the local ledger. Use an id returned by this server.', true)
        if (options.live(mission.missionId)) {
          // This app cannot answer a card: there is no tool for it, by design.
          if (options.waiting?.(mission.missionId) === true) return mcpText("Waiting for the person to approve or deny an action in Locust's window. This app cannot answer it; read_reply again later.")
          const last = mission.events.findLast(e => e.type === 'tool.started' || e.type === 'step.started')
          const doing = last?.type === 'tool.started' ? last.payload.title ?? `Using ${last.payload.name}` : last?.type === 'step.started' ? last.payload.message : undefined
          return mcpText(`Still working${doing ? `: ${doing}` : ': waiting for the AI agent to answer.'}`)
        }
        if (name === 'send_message') {
          if (!text(args.message, 8_000)) return mcpText('Give a message of up to 8,000 characters. Nothing was sent.', true)
          const owner = await options.owner(mission.missionId)
          if (owner === undefined) return mcpText('That conversation no longer has a teammate. Nothing was sent.', true)
          return started({ prompt: args.message, teammateId: owner, followUpOf: mission.missionId }, id)
        }
        const failed = mission.events.findLast(e => e.type === 'run.failed')
        if (mission.phase === 'failed') return mcpText(mission.hostFailureMessage ?? (failed?.type === 'run.failed' ? failed.payload.message : 'The AI agent ended without an answer.'), true)
        if (mission.phase !== 'completed') return mcpText('The run was interrupted or stopped before it finished.', true)
        const final = joinMessageFragments(mission.events).findLast(e => e.type === 'message.delta' && e.payload.final)
        return mcpText(final?.type === 'message.delta' ? unwrapProtocolTags(final.payload.text) : 'The AI agent finished without a text answer.')
      } finally { if (name === 'send_message') starting.delete(id) }
    }
    return mcpText('That tool is not offered by Locust.', true)
  }
}
