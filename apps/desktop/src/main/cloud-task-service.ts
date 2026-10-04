import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

import { releaseProcessTree } from '@teammate/runtime-adapters'
import type { ExecutableLaunch } from '@teammate/runtime-adapters'

import { folderOnGitHub, refusalFor, startAnswer, statusAnswer } from './cloud-tasks.js'
import type { CloudTask, FolderOnGitHub, Runner } from './cloud-tasks.js'

/**
 * The cloud tasks a person started from Locust, kept on disk so a restart
 * still knows them, and the four things Locust does with one: start it,
 * look at it, show its change, bring the change home (cloud-tasks.ts has the
 * why). Every `codex cloud` call goes through `codex`, every git call through
 * `git`: both no-shell, and both stand-ins in the tests.
 */
export interface CloudTaskServiceOptions {
  readonly file: string
  readonly codex: Runner
  readonly git: Runner
  readonly now?: () => Date
}

export type CloudStartResult =
  | { readonly ok: true; readonly task: CloudTask; readonly notes: readonly string[] }
  | { readonly ok: false; readonly message: string }

export interface CloudTaskService {
  list(folder?: string): Promise<readonly CloudTask[]>
  where(folder: string): Promise<FolderOnGitHub>
  start(input: { readonly folder: string; readonly prompt: string; readonly teammateId?: string }): Promise<CloudStartResult>
  refresh(taskId: string): Promise<CloudTask | undefined>
  diff(taskId: string): Promise<string | undefined>
  apply(taskId: string): Promise<{ readonly ok: true; readonly task: CloudTask } | { readonly ok: false; readonly message: string }>
}

const KEEP = 200

export function createCloudTaskService(options: CloudTaskServiceOptions): CloudTaskService {
  const now = options.now ?? (() => new Date())
  const read = async (): Promise<CloudTask[]> => {
    try {
      const value: unknown = JSON.parse(await readFile(options.file, 'utf8'))
      return Array.isArray(value) ? (value as CloudTask[]).filter((task) => typeof task?.taskId === 'string' && /^task_[A-Za-z0-9_]+$/.test(task.taskId)) : []
    } catch {
      return []
    }
  }
  const write = (tasks: readonly CloudTask[]): Promise<void> => writeFile(options.file, JSON.stringify(tasks.slice(-KEEP)), 'utf8')
  const replace = async (task: CloudTask): Promise<void> => {
    const tasks = await read()
    await write(tasks.map((entry) => (entry.taskId === task.taskId ? task : entry)))
  }
  const find = async (taskId: string): Promise<CloudTask | undefined> => (await read()).find((task) => task.taskId === taskId)

  return {
    async list(folder) {
      const tasks = await read()
      return folder === undefined ? tasks : tasks.filter((task) => task.folder.toLowerCase() === folder.toLowerCase())
    },
    where: (folder) => folderOnGitHub(folder, options.git),

    async start(input) {
      const prompt = input.prompt.trim()
      if (prompt.length === 0) return { ok: false, message: 'Say what the cloud task should do.' }
      const where = await folderOnGitHub(input.folder, options.git)
      if (where.repo === undefined) {
        return { ok: false, message: 'A cloud task works on a GitHub repository, and this folder has none. Push it to GitHub first, or send it here instead.' }
      }
      // What the cloud cannot see, said before it runs rather than after.
      const notes = [
        ...(where.unpushed !== undefined && where.unpushed > 0 ? [`${String(where.unpushed)} ${where.unpushed === 1 ? 'commit' : 'commits'} on ${where.branch ?? 'this branch'} ${where.unpushed === 1 ? 'is' : 'are'} not on GitHub, so the cloud works without ${where.unpushed === 1 ? 'it' : 'them'}.`] : []),
        ...(where.dirty ? ['Uncommitted changes in this folder stay here: the cloud works from what GitHub has.'] : [])
      ]
      const ran = await options.codex(['cloud', 'exec', '--env', where.repo, ...(where.branch === undefined ? [] : ['--branch', where.branch]), prompt], input.folder)
        .catch((error: unknown) => ({ code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }))
      const answer = startAnswer(ran, where.repo)
      if (!answer.ok) return { ok: false, message: refusalFor(answer.problem) }
      const task: CloudTask = {
        taskId: answer.taskId,
        url: answer.url,
        runtime: 'codex',
        repo: where.repo,
        branch: where.branch,
        prompt,
        folder: input.folder,
        createdAt: now().toISOString(),
        ...(input.teammateId === undefined ? {} : { teammateId: input.teammateId }),
        status: { state: 'pending', title: undefined, added: undefined, removed: undefined, files: undefined }
      }
      await write([...(await read()), task])
      return { ok: true, task, notes }
    },

    async refresh(taskId) {
      const task = await find(taskId)
      if (task === undefined) return undefined
      if (task.appliedAt !== undefined) return task
      const ran = await options.codex(['cloud', 'status', taskId], task.folder).catch(() => undefined)
      if (ran === undefined) return task
      const status = statusAnswer(`${ran.stdout}\n${ran.stderr}`)
      if (status.state === 'unknown') return task
      const next = { ...task, status }
      await replace(next)
      return next
    },

    async diff(taskId) {
      const task = await find(taskId)
      if (task === undefined) return undefined
      const ran = await options.codex(['cloud', 'diff', taskId], task.folder).catch(() => undefined)
      return ran?.code === 0 && /^diff --git /m.test(ran.stdout) ? ran.stdout : undefined
    },

    async apply(taskId) {
      const task = await find(taskId)
      if (task === undefined) return { ok: false, message: 'That cloud task is not one Locust started.' }
      if (task.appliedAt !== undefined) return { ok: false, message: 'Its change is already in this folder.' }
      const ran = await options.codex(['cloud', 'apply', taskId], task.folder).catch((error: unknown) => ({ code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }))
      if (ran.code !== 0) {
        const said = `${ran.stderr}\n${ran.stdout}`.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !/is ignored|unrecognized configuration/i.test(line)).pop()
        return { ok: false, message: `The change could not be applied here: ${said ?? 'Codex did not say why'}. Nothing in the folder was changed by Locust.` }
      }
      const next = { ...task, appliedAt: now().toISOString(), status: { ...task.status, state: 'applied' as const } }
      await replace(next)
      return { ok: true, task: next }
    }
  }
}

/**
 * A discovered executable run with arguments, no shell, and a time limit --
 * the prompt is an argument, and a shell would read it. The whole process tree
 * is ended on a timeout: an npm shim's child outlives a killed parent.
 */
export function launchRunner(launch: () => Promise<ExecutableLaunch | undefined>, timeoutMs: number): Runner {
  return async (args, cwd) => {
    const executable = await launch()
    if (executable === undefined) return { code: 127, stdout: '', stderr: 'Codex CLI is not installed or not signed in.' }
    return new Promise((resolve) => {
      const child = spawn(executable.executablePath, [...executable.prefixArgs, ...args], {
        cwd,
        windowsHide: true,
        shell: false,
        env: { ...process.env, ...(executable.env ?? {}) }
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid !== undefined) void releaseProcessTree(child.pid).catch(() => false).finally(() => child.kill())
        else child.kill()
        resolve({ code: 124, stdout, stderr: `${stderr}\nTook longer than ${String(Math.round(timeoutMs / 1000))} s.` })
      }, timeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => { if (stdout.length < 8_000_000) stdout += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 200_000) stderr += chunk.toString('utf8') })
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ code: 127, stdout, stderr: error.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? 1, stdout, stderr })
      })
    })
  }
}
