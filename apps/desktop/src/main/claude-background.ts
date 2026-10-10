/**
 * CLAUDE WORK THAT KEEPS GOING WHEN LOCUST CLOSES (W10, 0.683).
 *
 * Claude Code runs a session in the background under a supervisor of its own
 * that outlives the terminal (and Locust): `claude --bg "<prompt>"` starts
 * one and returns, `claude agents --json` lists them, `claude attach <id>`
 * opens one in a terminal, and `stop` / `rm` end and remove it (2.1.292,
 * `claude --help`). Locust's own runs are its child processes and end when it
 * quits; a turn sent "in the background" is Claude Code's instead, and Locust
 * only watches it.
 *
 * That trade is said where the choice is made: Locust's approval cards and
 * spend limits do not reach a session Locust does not run. Claude Code's own
 * permission mode does, and a session that stops to ask waits for the person
 * in `claude attach` -- Locust never answers for them.
 *
 * MEASURED 2026-10-06 on three Haiku sessions in a scratch folder: a
 * background entry is `{id, cwd, kind: "background", startedAt (epoch ms),
 * sessionId, name, state}`, with `pid`, `status` and, when blocked,
 * `waitingFor: "permission prompt"`. `--bg` prints "backgrounded · <id>",
 * the id being the session id's first eight characters; `--` before the
 * message is accepted. States seen: working -> blocked (an edit in Ask, and a
 * `git commit` it chose to make in Accept edits) -> stopped, and working ->
 * done, where the session stays alive and idle rather than exiting. `--bg` refuses a folder
 * Claude Code has not been told to trust ("Workspace not trusted. Run `claude`
 * in <dir> once and accept the trust prompt, then retry."), even under a
 * trusted parent, and with `--restricted`.
 */

export type BackgroundState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped' | 'unknown'

export interface BackgroundAgent {
  readonly id: string
  readonly sessionId?: string
  readonly cwd?: string
  readonly name?: string
  readonly startedAt?: string
  readonly state: BackgroundState
  /** What a blocked session waits on, in Claude Code's own words when it gives any. */
  readonly waitingFor?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined)

const STATES: readonly BackgroundState[] = ['working', 'blocked', 'done', 'failed', 'stopped']

/** Claude Code's state word, or `unknown` for one this build has not met (never a guess). */
export function backgroundStateOf(value: unknown): BackgroundState {
  const word = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (STATES as readonly string[]).includes(word) ? (word as BackgroundState) : 'unknown'
}

/** What a blocked session says it waits for: a string, or an object's own words. */
function waitingWords(value: unknown): string | undefined {
  if (typeof value === 'string') return text(value)
  if (!isRecord(value)) return undefined
  for (const key of ['message', 'description', 'title', 'tool', 'kind', 'type']) {
    const said = text(value[key])
    if (said !== undefined) return said
  }
  return undefined
}

/**
 * The background sessions in `claude agents --json`; interactive ones and malformed entries are left out.
 * Undefined when the answer is not a list at all: MEASURED 2026-10-06, one call in a dozen printed nothing, and
 * reading that as "no sessions" would have said every live one had stopped.
 */
export function parseBackgroundAgents(json: string): readonly BackgroundAgent[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const agents: BackgroundAgent[] = []
  for (const entry of parsed) {
    if (!isRecord(entry) || entry.kind !== 'background') continue
    const id = text(entry.id)
    if (id === undefined) continue
    const sessionId = text(entry.sessionId)
    const cwd = text(entry.cwd)
    const name = text(entry.name)
    // Epoch milliseconds, measured; text accepted too.
    const startedAt = typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? new Date(entry.startedAt).toISOString() : text(entry.startedAt)
    const waitingFor = waitingWords(entry.waitingFor)
    agents.push({
      id,
      state: backgroundStateOf(entry.state),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(name === undefined ? {} : { name }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(waitingFor === undefined ? {} : { waitingFor })
    })
  }
  return agents
}

/** Still going: Locust keeps watching. Done, failed and stopped are over; so is one Claude Code no longer lists. */
export function backgroundIsLive(state: BackgroundState): boolean {
  return state === 'working' || state === 'blocked' || state === 'unknown'
}

/** The card's words for a state. */
export function backgroundSentence(agent: Pick<BackgroundAgent, 'state' | 'waitingFor'>): string {
  switch (agent.state) {
    case 'working': return 'Working in the background.'
    case 'blocked': return `Waiting for you${agent.waitingFor === undefined ? '' : `: ${agent.waitingFor}`}. Open it to answer; Locust does not answer for you.`
    case 'done': return 'Finished in the background.'
    case 'failed': return 'Stopped with an error in the background. Open it to see what happened.'
    case 'stopped': return 'Stopped.'
    case 'unknown': return 'Running in the background.'
  }
}

/** Locust's mode, said as Claude Code's own permission mode for a session Locust does not run. */
export function backgroundPermissionMode(sandbox: 'read-only' | 'workspace-write' | 'full-access', askEach = false): 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions' {
  // Approve each: Claude Code's own default mode asks before each edit, in `claude attach`.
  if (askEach && sandbox === 'workspace-write') return 'default'
  return sandbox === 'read-only' ? 'plan' : sandbox === 'workspace-write' ? 'acceptEdits' : 'bypassPermissions'
}

/** `claude --bg ...`: the conversation's own session when it has one, in the folder, on the chosen model and mode. */
export function backgroundArgs(options: {
  readonly prompt: string
  readonly sandbox: 'read-only' | 'workspace-write' | 'full-access'
  readonly askEach?: boolean
  readonly model?: string
  readonly effort?: string
  readonly resumeSessionId?: string
}): readonly string[] {
  const prompt = options.prompt.trim()
  if (prompt.length === 0) throw new Error('A background turn needs a message.')
  return [
    '--bg',
    ...(options.resumeSessionId === undefined ? [] : ['--resume', options.resumeSessionId]),
    '--permission-mode',
    backgroundPermissionMode(options.sandbox, options.askEach === true),
    ...(options.model === undefined ? [] : ['--model', options.model]),
    ...(options.effort === undefined ? [] : ['--effort', options.effort]),
    // After `--`, so a message that begins with a dash is a message, never a flag.
    '--',
    prompt
  ]
}

/** `Workspace not trusted. ...`: the folder needs the person, once, in Claude Code itself. */
export function needsTrust(said: string): boolean {
  return /workspace not trusted|accept the trust prompt/i.test(said)
}

/** The id `claude --bg` prints, from what it printed. */
export function backgroundIdFrom(said: string): string | undefined {
  // "backgrounded · ad39859a", measured.
  return /backgrounded\s*\S\s*([0-9a-f]{6,})/i.exec(said)?.[1]
}

/**
 * Watching background sessions: `claude agents --json` every few seconds
 * while any of Locust's own is live, and not at all once none is -- Locust at
 * rest stays under 1% CPU (Colin, 10/05).
 */
export function createBackgroundWatch(options: {
  readonly list: () => Promise<readonly BackgroundAgent[]>
  readonly onChange: (agents: readonly BackgroundAgent[]) => void
  readonly intervalMs?: number
  readonly setTimer?: (run: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}) {
  const watched = new Set<string>()
  const intervalMs = options.intervalMs ?? 5_000
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let timer: unknown
  // A tick in flight reschedules itself: a watch() then must not start a second loop (2026-10-10 sweep).
  let ticking = false
  let last = ''
  const tick = async (): Promise<void> => {
    timer = undefined
    ticking = true
    const all = await options.list().catch(() => undefined)
    ticking = false
    if (all !== undefined) {
      const ours = all.filter((agent) => watched.has(agent.id))
      // One Claude Code no longer lists is over: it was removed, or its supervisor went with the machine.
      const missing = [...watched].filter((id) => !ours.some((agent) => agent.id === id))
      const seen = [...ours, ...missing.map((id): BackgroundAgent => ({ id, state: 'stopped' }))]
      for (const agent of seen) if (!backgroundIsLive(agent.state)) watched.delete(agent.id)
      const said = JSON.stringify(seen)
      if (said !== last) {
        last = said
        options.onChange(seen)
      }
    }
    if (watched.size > 0) timer = setTimer(() => void tick(), intervalMs)
  }
  return {
    /** Start (or keep) watching these ids. */
    watch(ids: readonly string[]): void {
      for (const id of ids) watched.add(id)
      if (watched.size > 0 && timer === undefined && !ticking) timer = setTimer(() => void tick(), 0)
    },
    watching(): readonly string[] {
      return [...watched]
    },
    stop(): void {
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
      watched.clear()
    }
  }
}
