import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { leavingNoLog, readsLikeCodexLog } from './cloud-tasks.js'
import type { Runner } from './cloud-tasks.js'

/**
 * CODEX CLOUD LEAVES NO LOG IN THE FOLDER (0.681).
 *
 * `codex cloud` writes error.log -- the ChatGPT account id among it -- into the folder it runs in, and Locust
 * asks it about a GitHub folder on its own. The first real pull request from Commit carried that file. Each call
 * now leaves error.log as it found it, and never touches lines that are not Codex's.
 */
const NL = String.fromCharCode(10)
const CODEX = `[2026-10-07T00:53:04.543477800+00:00] startup: base_url=https://chatgpt.com/backend-api path_style=wham${NL}[2026-10-07T00:53:04.544123400+00:00] auth: mode=ChatGPT account_id=0000${NL}`
const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'locust-cloud-log-'))
  made.push(dir)
  return dir
}
/** What `codex cloud` does: appends its lines to error.log in its cwd. */
const codexLike = (lines = CODEX): Runner => async (_args, cwd) => {
  await appendFile(join(cwd, 'error.log'), lines)
  return { code: 0, stdout: 'ok', stderr: '' }
}

describe('codex cloud leaves no log in the folder', () => {
  it('a log the call made is gone afterwards, and the answer is unchanged', async () => {
    const dir = await folder()
    const ran = await leavingNoLog(codexLike())(['cloud', 'list'], dir)
    expect(ran).toEqual({ code: 0, stdout: 'ok', stderr: '' })
    await expect(stat(join(dir, 'error.log'))).rejects.toThrow()
  })

  it("the person's own error.log keeps its lines; only Codex's are taken off", async () => {
    const dir = await folder()
    await writeFile(join(dir, 'error.log'), `my app crashed${NL}`)
    await leavingNoLog(codexLike())(['cloud', 'list'], dir)
    expect(await readFile(join(dir, 'error.log'), 'utf8')).toBe(`my app crashed${NL}`)
  })

  it('what does not read like Codex is never removed', async () => {
    const dir = await folder()
    await leavingNoLog(codexLike(`something else wrote this${NL}`))(['cloud', 'list'], dir)
    expect(await readFile(join(dir, 'error.log'), 'utf8')).toBe(`something else wrote this${NL}`)
  })

  it('also when the call fails, and with two calls on one folder at once', async () => {
    const dir = await folder()
    const failing: Runner = async (_args, cwd) => {
      await appendFile(join(cwd, 'error.log'), CODEX)
      throw new Error('codex went away')
    }
    await expect(leavingNoLog(failing)(['cloud', 'status'], dir)).rejects.toThrow('codex went away')
    const run = leavingNoLog(codexLike())
    await Promise.all([run(['cloud', 'list'], dir), run(['cloud', 'list'], dir), run(['cloud', 'list'], dir)])
    await expect(stat(join(dir, 'error.log'))).rejects.toThrow()
  })

  it("recognises Codex's lines and nothing else", () => {
    expect(readsLikeCodexLog(CODEX)).toBe(true)
    expect(readsLikeCodexLog(`${CODEX}my own line${NL}`)).toBe(false)
  })
})
