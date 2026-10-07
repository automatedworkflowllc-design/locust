import { describe, expect, it, vi } from 'vitest'
import type { CodexMissionStartResponse, MissionReadResponse, PublicRecoveredMission, TeammateListResponse } from '../shared/ipc.js'
import { createLocustMcpTools } from './locust-mcp-tools.js'
import { mcpText } from './locust-mcp-host.js'
import { seedAvatar } from '../shared/avatar.js'

const teammates: TeammateListResponse = { ok: true, data: { teammates: [{ teammateId: 'tm_wren', name: 'Wren', role: 'Custom', roleTitle: 'Reviewer', hue: 'lime', avatar: seedAvatar('tm_wren'), createdAt: '2026-10-07', route: { runtime: 'codex', model: 'model-test', mode: 'auto' } }], missionOwners: {}, missionTitles: {} } }
const mission = (overrides: Partial<PublicRecoveredMission> = {}): PublicRecoveredMission => ({ missionId: 'mission_1', startedBy: { kind: 'mcp' }, phase: 'completed', events: [], ...overrides }) as PublicRecoveredMission
function fixture() {
  const start = vi.fn(async (): Promise<CodexMissionStartResponse> => ({ ok: true, data: { missionId: 'mission_1' } } as CodexMissionStartResponse))
  const read = vi.fn(async (): Promise<MissionReadResponse> => ({ ok: true, data: { mission: mission() } }))
  const background = vi.fn(async () => [])
  const deps = { teammates: vi.fn(async () => teammates), busy: vi.fn(() => true), start, read, newest: vi.fn(async id => id), owner: vi.fn(async () => 'tm_wren'), live: vi.fn(() => false), background }
  return { ...deps, call: createLocustMcpTools(deps) }
}
describe('other apps can only ask Locust teammates', () => {
  it('starts a writing teammate in Ask, ignores caller mode/route, and keeps the saved route', async () => {
    const f = fixture()
    const result = await f.call('start_conversation', { teammate: 'wReN', message: 'Review this.', mode: 'auto', runtime: 'claude' })
    expect(f.start).toHaveBeenCalledWith({ teammateId: 'tm_wren', prompt: 'Review this.', mode: 'ask', keepSavedRoute: true }, { kind: 'mcp' })
    expect(result).toEqual(mcpText(JSON.stringify({ conversation_id: 'mission_1', mode: 'ask' })))
    expect(teammates.ok && teammates.data.teammates[0]?.route?.mode).toBe('auto')
  })
  it('uses an exact teammate id and reports the host monthly-limit sentence verbatim', async () => {
    const f = fixture()
    const sentence = 'Wren has reached the $10 monthly limit you set. Nothing was started.'
    f.start.mockResolvedValue({ ok: false, error: { code: 'SPEND_LIMIT_REACHED', message: sentence } })
    expect(await f.call('start_conversation', { teammate: 'tm_wren', message: 'Review this.' })).toEqual(mcpText(sentence, true))
  })
  it('lists public teammate identity, route and busy state, but never the stores or keys', async () => {
    const f = fixture()
    expect(await f.call('list_teammates', {})).toEqual(mcpText(JSON.stringify([{ id: 'tm_wren', name: 'Wren', role: 'Reviewer', runtime: 'codex', model: 'model-test', busy: true }])))
    expect(f.start).not.toHaveBeenCalled()
  })
  it('continues the newest turn in Ask and returns the stable conversation id', async () => {
    const f = fixture()
    f.newest.mockResolvedValue('mission_2')
    f.read.mockResolvedValueOnce({ ok: true, data: { mission: mission() } }).mockResolvedValueOnce({ ok: true, data: { mission: mission({ missionId: 'mission_2' }) } })
    expect(await f.call('send_message', { conversation_id: 'mission_1', message: 'And this?', mode: 'auto' })).toEqual(mcpText(JSON.stringify({ conversation_id: 'mission_1', mode: 'ask' })))
    expect(f.start).toHaveBeenCalledWith({ teammateId: 'tm_wren', prompt: 'And this?', followUpOf: 'mission_2', mode: 'ask', keepSavedRoute: true }, { kind: 'mcp' })
  })
  it('reports activity and does not queue a message while the turn is running', async () => {
    const f = fixture()
    f.live.mockReturnValue(true)
    f.read.mockResolvedValue({ ok: true, data: { mission: mission({ events: [{ type: 'tool.started', payload: { name: 'Read', title: 'Reading the source' } }] as unknown as PublicRecoveredMission['events'] }) } })
    expect(await f.call('read_reply', { conversation_id: 'mission_1' })).toEqual(mcpText('Still working: Reading the source'))
    expect(await f.call('send_message', { conversation_id: 'mission_1', message: 'next' })).toEqual(mcpText('Still working: Reading the source'))
    expect(f.start).not.toHaveBeenCalled()
  })
  it('returns the newest complete reply rather than an earlier answer or partial text', async () => {
    const f = fixture()
    f.read.mockResolvedValue({ ok: true, data: { mission: mission({ events: [
      { type: 'message.delta', payload: { itemId: 'a', operation: 'append', text: 'earlier', final: true } },
      { type: 'message.delta', payload: { itemId: 'b', operation: 'append', text: 'new ', final: false } },
      { type: 'message.delta', payload: { itemId: 'b', operation: 'append', text: 'answer', final: true } }
    ] as unknown as PublicRecoveredMission['events'] }) } })
    expect(await f.call('read_reply', { conversation_id: 'mission_1' })).toEqual(mcpText('new answer'))
  })
  it('returns the host failure in Locust words, not a previous successful answer', async () => {
    const f = fixture()
    f.read.mockResolvedValue({ ok: true, data: { mission: mission({ phase: 'failed', hostFailureMessage: 'The run could not save its record. Nothing was retried.' }) } })
    expect(await f.call('read_reply', { conversation_id: 'mission_1' })).toEqual(mcpText('The run could not save its record. Nothing was retried.', true))
  })
  it('lists background turns without starting or stopping anything', async () => {
    const f = fixture()
    expect(await f.call('list_background_runs', {})).toEqual(mcpText('[]'))
    expect(f.background).toHaveBeenCalledOnce()
    expect(f.start).not.toHaveBeenCalled()
  })
  it('refuses invalid messages, unknown teammates, unknown tools and non-server conversations', async () => {
    const f = fixture()
    for (const args of [{ teammate: 'Wren', message: '' }, { teammate: 'Wren', message: 'x'.repeat(8001) }, { teammate: 'missing', message: 'hi' }]) expect((await f.call('start_conversation', args)).isError).toBe(true)
    expect((await f.call('delete_files', {})).isError).toBe(true)
    f.read.mockResolvedValue({ ok: true, data: { mission: mission({ startedBy: undefined }) } })
    expect((await f.call('send_message', { conversation_id: 'person_1', message: 'hi' })).isError).toBe(true)
    expect(f.start).not.toHaveBeenCalled()
  })
  it('claims a send before the first asynchronous ledger read, refusing simultaneous sends', async () => {
    const f = fixture()
    let release!: (value: MissionReadResponse) => void
    f.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = f.call('send_message', { conversation_id: 'mission_1', message: 'first' })
    expect(await f.call('send_message', { conversation_id: 'mission_1', message: 'second' })).toEqual(mcpText('Still working: starting the next turn.'))
    release({ ok: true, data: { mission: mission() } })
    await first
    expect(f.start).toHaveBeenCalledOnce()
  })
})
