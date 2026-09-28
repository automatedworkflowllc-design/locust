import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * THE PROJECT'S FILES, FOR `@` IN THE COMPOSER (0.436).
 *
 * Claude Code offers the project's files the moment you type `@`; VelaTerm
 * (vlinx-io/VelaTerm, MIT, read 2026-09-28 at Colin's "anything to yoink")
 * completes paths as you type. Locust's only way to attach a file of the
 * project was a native dialog.
 *
 * Git's own list when the folder is a repository -- tracked files and new
 * ones, less what it ignores, so node_modules and build output stay out the
 * way the person already said they should. Otherwise a bounded walk that
 * skips the folders nobody attaches from. Paths are the folder's own,
 * forward-slashed, and never leave it: the renderer names no folder.
 */
export const MAX_LISTED_FILES = 5_000
const SKIPPED = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'release', '.next', 'target', '__pycache__', '.venv', 'venv', '.locust', '.cache', 'coverage'])
const MAX_DEPTH = 8

export interface WorkspaceFiles {
  readonly paths: readonly string[]
  /** More than MAX_LISTED_FILES: the list is the first ones found. */
  readonly truncated: boolean
}

function gitFiles(root: string): Promise<readonly string[] | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, windowsHide: true, timeout: 5_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) return resolve(undefined)
      resolve(stdout.split('\0').filter((path) => path.length > 0))
    })
  })
}

async function walked(root: string): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }> {
  const paths: string[] = []
  let truncated = false
  const visit = async (relative: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(relative.length === 0 ? root : join(root, relative), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return
      const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) await visit(path, depth + 1)
      } else if (entry.isFile()) {
        if (paths.length >= MAX_LISTED_FILES) {
          truncated = true
          return
        }
        paths.push(path)
      }
    }
  }
  await visit('', 0)
  return { paths, truncated }
}

export async function listWorkspaceFiles(root: string, options: { readonly git?: (root: string) => Promise<readonly string[] | undefined> } = {}): Promise<WorkspaceFiles> {
  const fromGit = await (options.git ?? gitFiles)(root)
  if (fromGit !== undefined) {
    const kept = fromGit
      .map((path) => path.replace(/\\/g, '/'))
      // Never a path that climbs out, whatever git said.
      .filter((path) => !path.startsWith('/') && !path.split('/').includes('..') && !/^[A-Za-z]:/.test(path))
      .filter((path) => !path.split('/').some((part) => part === '.locust'))
    return { paths: kept.slice(0, MAX_LISTED_FILES), truncated: kept.length > MAX_LISTED_FILES }
  }
  return walked(root)
}
