import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  backgroundArgs,
  backgroundIdFrom,
  backgroundIsLive,
  createBackgroundWatch,
  needsTrust,
  parseBackgroundAgents
} from './claude-background.js'
import type { BackgroundAgent, BackgroundState } from './claude-background.js'

/**
 * THE BACKGROUND TURNS LOCUST STARTED (W10, 0.683).
 *
 * Each is started with `claude --bg`, kept in a file of its own -- never the
 * conversation record while it runs, because Locust does not run it -- and
 * watched while it lives. When it ends it is brought into its conversation
 * the way a turn had in the terminal is (terminal-catch-up.ts), or into a new
 * conversation when it began one (session-import.ts). One that ended while
 * Locust was closed is found the next time Locust opens.
 */

/** One background turn, as it is kept across launches. */
export interface BackgroundRun {
  readonly id: string
  readonly sessionId?: string
  readonly folder: string
  readonly prompt: string
  readonly startedAt: string
  /** The conversation it continues (any turn of it), when it continues one. */
  readonly conversation?: string
  readonly teammateId?: string
  readonly model?: string
  readonly state: BackgroundState
  readonly waitingFor?: string
  readonly name?: string
  /** The conversation turn it came back as, once it is over. */
  readonly broughtIn?: string
  /** It is over but could not be brought back: why, in words. */
  readonly notBroughtIn?: string
}

export type StartBackground =
  | { readonly ok: true; readonly run: BackgroundRun }
  | { readonly ok: false; readonly message: string; readonly needsTrust?: true }

export interface BackgroundFacts {
  readonly file: string
  /** `claude <args>` in `cwd`, resolving when the process exits, with what it printed. */
  readonly claude: (args: readonly string[], cwd: string) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>
  /** The conversation's Claude session, from any turn of it; undefined when it has none. */
  readonly sessionOf: (conversation: string) => Promise<string | undefined>
  /** Bring a finished run into the record: the turn's mission id, or why not. */
  readonly bringIn: (run: BackgroundRun) => Promise<{ readonly missionId: string } | { readonly refused: string }>
  readonly onChange: (runs: readonly BackgroundRun[]) => void
  readonly now?: () => Date
  /** Test seam: the watch, with its own timer. */
  readonly watch?: (onAgents: (agents: readonly BackgroundAgent[]) => void, list: () => Promise<readonly BackgroundAgent[]>) => {
    readonly watch: (ids: readonly string[]) => void
    readonly stop: () => void
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
/** The id Claude Code gives a background session: hex, as measured. Nothing else is passed on to it. */
const SESSION_ID = /^[0-9a-f]{6,64}$/i

export function createBackgroundRuns(facts: BackgroundFacts) {
  const now = facts.now ?? (() => new Date())
  let runs: BackgroundRun[] | undefined
  let writing: Promise<void> = Promise.resolve()

  const load = async (): Promise<BackgroundRun[]> => {
    if (runs !== undefined) return runs
    try {
      const parsed: unknown = JSON.parse(await readFile(facts.file, 'utf8'))
      runs = Array.isArray(parsed)
        ? (parsed.filter((entry) => isRecord(entry) && typeof entry.id === 'string' && SESSION_ID.test(entry.id) && typeof entry.folder === 'string' && typeof entry.prompt === 'string') as BackgroundRun[])
        : []
    } catch {
      runs = []
    }
    return runs
  }
  const save = async (): Promise<void> => {
    const body = `${JSON.stringify(runs ?? [], null, 1)}\n`
    writing = writing
      .then(async () => {
        await mkdir(dirname(facts.file), { recursive: true })
        const temporary = `${facts.file}.${String(process.pid)}.tmp`
        await writeFile(temporary, body, 'utf8')
        await rename(temporary, facts.file)
      })
      .catch(() => undefined)
    await writing
  }
  const update = async (id: string, change: Partial<BackgroundRun>): Promise<BackgroundRun | undefined> => {
    const all = await load()
    const at = all.findIndex((run) => run.id === id)
    if (at < 0) return undefined
    const next: BackgroundRun = { ...all[at]!, ...change }
    // A waiting-for that is over is gone, not kept as stale words.
    if (change.state !== undefined && change.state !== 'blocked' && change.waitingFor === undefined) delete (next as { waitingFor?: string }).waitingFor
    all[at] = next
    await save()
    facts.onChange([...all])
    return next
  }
  const finish = async (run: BackgroundRun): Promise<void> => {
    if (run.broughtIn !== undefined || run.notBroughtIn !== undefined) return
    const back = await facts.bringIn(run).catch((error: unknown) => ({ refused: error instanceof Error ? error.message : 'It could not be brought back.' }))
    await update(run.id, 'missionId' in back ? { broughtIn: back.missionId } : { notBroughtIn: back.refused })
    /*
     * Done, and its turn is in the conversation: Claude Code's session is stopped, not left idle. MEASURED
     * 2026-10-06: a finished background session stays alive, and the conversation's next turn -- `--resume` of a
     * session still alive -- went into a COPY under a new id. Stopped, the conversation stays one session; Claude
     * Code keeps its conversation (`claude stop --help`).
     */
    if ('missionId' in back && run.state === 'done' && SESSION_ID.test(run.id)) await facts.claude(['stop', run.id], run.folder).catch(() => undefined)
  }
  const listAgents = async (): Promise<readonly BackgroundAgent[]> => {
    const where = (await load())[0]?.folder ?? process.cwd()
    const answer = await facts.claude(['agents', '--json', '--all'], where)
    const parsed = answer.code === 0 ? parseBackgroundAgents(answer.stdout) : undefined
    // No answer is not "none are running": the watch skips this round.
    if (parsed === undefined) throw new Error('claude agents gave no answer')
    return parsed
  }
  const seen = (agents: readonly BackgroundAgent[]): void => {
    void (async () => {
      for (const agent of agents) {
        const run = await update(agent.id, {
          state: agent.state,
          ...(agent.sessionId === undefined ? {} : { sessionId: agent.sessionId }),
          ...(agent.name === undefined ? {} : { name: agent.name }),
          ...(agent.waitingFor === undefined ? {} : { waitingFor: agent.waitingFor })
        })
        if (run !== undefined && !backgroundIsLive(run.state)) await finish(run)
      }
    })()
  }
  const watch = facts.watch !== undefined ? facts.watch(seen, listAgents) : createBackgroundWatch({ list: listAgents, onChange: seen })

  return {
    /** Picks up where the last launch left off: watches what is open, brings back what ended meanwhile. */
    async resume(): Promise<void> {
      const open = (await load()).filter((run) => run.broughtIn === undefined && run.notBroughtIn === undefined)
      if (open.length > 0) watch.watch(open.map((run) => run.id))
    },
    async list(): Promise<readonly BackgroundRun[]> {
      return [...(await load())]
    },
    async start(request: {
      readonly prompt: string
      readonly folder: string
      readonly sandbox: 'read-only' | 'workspace-write' | 'full-access'
      readonly askEach?: boolean
      readonly conversation?: string
      readonly teammateId?: string
      readonly model?: string
      readonly effort?: string
    }): Promise<StartBackground> {
      const resumeSessionId = request.conversation === undefined ? undefined : await facts.sessionOf(request.conversation).catch(() => undefined)
      let args: readonly string[]
      try {
        args = backgroundArgs({
          prompt: request.prompt,
          sandbox: request.sandbox,
          ...(request.askEach === true ? { askEach: true } : {}),
          ...(request.model === undefined ? {} : { model: request.model }),
          ...(request.effort === undefined ? {} : { effort: request.effort }),
          ...(resumeSessionId === undefined ? {} : { resumeSessionId })
        })
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'That could not be sent.' }
      }
      const ran = await facts.claude(args, request.folder).catch((error: unknown) => ({ code: 127, stdout: '', stderr: error instanceof Error ? error.message : '' }))
      const said = `${ran.stdout}\n${ran.stderr}`
      if (needsTrust(said)) {
        return {
          ok: false,
          needsTrust: true,
          message: 'Claude Code has not been told to trust this folder, so it will not work here in the background yet. Open Claude Code in this folder once, answer its question, then send again.'
        }
      }
      const id = backgroundIdFrom(said)
      if (ran.code !== 0 || id === undefined) {
        const line = said.split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0)
        return { ok: false, message: `Claude Code did not start it in the background${line === undefined ? '.' : `: ${line.slice(0, 300)}`}` }
      }
      const run: BackgroundRun = {
        id,
        folder: request.folder,
        prompt: request.prompt.trim(),
        startedAt: now().toISOString(),
        state: 'working',
        ...(resumeSessionId === undefined ? {} : { sessionId: resumeSessionId }),
        ...(request.conversation === undefined ? {} : { conversation: request.conversation }),
        ...(request.teammateId === undefined ? {} : { teammateId: request.teammateId }),
        ...(request.model === undefined ? {} : { model: request.model })
      }
      const all = await load()
      all.push(run)
      await save()
      facts.onChange([...all])
      watch.watch([id])
      return { ok: true, run }
    },
    /** `claude stop <id>`: Claude Code keeps the conversation; it comes back like any finished run. */
    async stop(id: string): Promise<boolean> {
      const run = (await load()).find((entry) => entry.id === id)
      if (run === undefined || !SESSION_ID.test(id)) return false
      const ran = await facts.claude(['stop', id], run.folder).catch(() => undefined)
      return ran?.code === 0
    },
    /** Takes an ended run off the list; its turn stays in the conversation. */
    async dismiss(id: string): Promise<void> {
      const all = await load()
      const at = all.findIndex((run) => run.id === id && !backgroundIsLive(run.state))
      if (at < 0) return
      all.splice(at, 1)
      await save()
      facts.onChange([...all])
    },
    /** The run a conversation turn came back from, for the divider that says so. */
    async broughtInIds(): Promise<ReadonlySet<string>> {
      return new Set((await load()).flatMap((run) => (run.broughtIn === undefined ? [] : [run.broughtIn])))
    },
    dispose(): void {
      watch.stop()
    }
  }
}

export type BackgroundRuns = ReturnType<typeof createBackgroundRuns>
