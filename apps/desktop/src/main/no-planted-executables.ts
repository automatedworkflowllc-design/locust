/**
 * H1: A BARE NAME IS NEVER FOUND IN THE FOLDER IT RUNS IN.
 *
 * On Windows a program started by bare name -- `git`, `cmd.exe`,
 * `powershell.exe`, `npm` -- is looked for in the child's working directory
 * BEFORE the PATH (libuv's search_path, whenever
 * NeedCurrentDirectoryForExePathW() says so, which is the default). Locust
 * runs `git` with the person's project as the working directory at every
 * launch and around every writing run, so a `git.exe` committed to a cloned
 * repository ran, silently, with the person's rights (the code review's H1).
 *
 * Windows' own switch turns that search off: with
 * NoDefaultCurrentDirectoryInExePath set, NeedCurrentDirectoryForExePathW()
 * answers no, for this process and -- through the environment -- for every
 * child and every cmd.exe after it. Imported FIRST by index.ts, so it is set
 * before anything is spawned; the runners' reduced environment carries it
 * too (process-runner's allowlist).
 */
export const NO_CWD_SEARCH = 'NoDefaultCurrentDirectoryInExePath'

export function refuseExecutablesFromTheWorkingFolder(env: NodeJS.ProcessEnv = process.env): void {
  env[NO_CWD_SEARCH] = '1'
}

refuseExecutablesFromTheWorkingFolder()
