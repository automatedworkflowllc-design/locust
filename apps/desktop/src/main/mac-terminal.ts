import { spawn } from 'node:child_process'
import { join } from 'node:path'

/** Resolves once the process has started, or with the reason it did not. */
function started(child: ReturnType<typeof spawn>): Promise<true | Error> {
  return new Promise((resolve) => {
    child.once('spawn', () => resolve(true))
    child.once('error', (error) => resolve(error))
  })
}

/**
 * THE MAC'S TERMINAL (the first macOS build, 2026-09-29). A `.command` file is
 * what Terminal opens and runs: this one goes to the conversation's folder,
 * carries the environment the launch needs, removes itself, and becomes the
 * runtime's resume. Every word single-quoted for the shell, so a path with a
 * space or a quote arrives as it is.
 */
export function macCommandScript(program: { readonly file: string; readonly args: readonly string[] }, cwd: string, env?: Readonly<Record<string, string>>): string {
  const quoted = (value: string): string => `'${value.split("'").join(`'"'"'`)}'`
  return [
    '#!/bin/zsh -l',
    'rm -f -- "$0"',
    `cd ${quoted(cwd)} || exit 1`,
    ...Object.entries(env ?? {}).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).map(([name, value]) => `export ${name}=${quoted(value)}`),
    `exec ${[program.file, ...program.args].map(quoted).join(' ')}`,
    ''
  ].join('\n')
}

export async function openInMacTerminal(cwd: string, program: { readonly file: string; readonly args: readonly string[] }, env: Readonly<Record<string, string>> | undefined, run: typeof spawn = spawn): Promise<{ readonly ok: true; readonly where: 'Terminal' } | { readonly ok: false; readonly message: string }> {
  const { chmod, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { randomUUID } = await import('node:crypto')
  const script = join(tmpdir(), `locust-terminal-${randomUUID()}.command`)
  try {
    await writeFile(script, macCommandScript(program, cwd, env), 'utf8')
    await chmod(script, 0o700)
    const child = run('open', ['-a', 'Terminal', script], { detached: true, stdio: 'ignore' })
    const result = await started(child)
    if (result !== true) return { ok: false, message: `Terminal could not be opened (${result.message}). The conversation is here, as it was.` }
    child.unref()
    return { ok: true, where: 'Terminal' }
  } catch (error) {
    return { ok: false, message: `Terminal could not be opened (${error instanceof Error ? error.message : String(error)}). The conversation is here, as it was.` }
  }
}

