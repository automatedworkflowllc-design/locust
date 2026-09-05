import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  isInsideDirectory,
  readRememberedWorkspace,
  resolveWorkspacePath,
  workspaceIdFor,
  writeRememberedWorkspace
} from './workspace.js'

const INSTALL = 'C:\\Users\\colin\\AppData\\Local\\Programs\\Locust'

describe('which folder the teammates work in', () => {
  it('is the folder the app was launched from, as it always was', () => {
    expect(
      resolveWorkspacePath({
        argv: ['Locust.exe'],
        cwd: 'C:\\work\\pebble',
        installDirectory: INSTALL,
        remembered: undefined,
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\work\\pebble', source: 'launch-folder' })
  })

  it('is NEVER the install folder -- the Start menu launches the app from there', () => {
    // Colin, 2026-09-05: every teammate was working inside
    // AppData\Local\Programs\Locust and Antigravity was the route that said so.
    expect(
      resolveWorkspacePath({
        argv: ['Locust.exe'],
        cwd: INSTALL,
        installDirectory: INSTALL,
        remembered: undefined,
        platform: 'win32'
      })
    ).toEqual({ path: undefined, source: 'none' })
  })

  it('treats a folder UNDER the install folder the same, whatever its case', () => {
    expect(
      resolveWorkspacePath({
        argv: [],
        cwd: 'c:\\users\\COLIN\\appdata\\local\\programs\\locust\\resources',
        installDirectory: INSTALL,
        remembered: undefined,
        platform: 'win32'
      }).source
    ).toBe('none')
    // Case is meaningful on Linux, so the same two spellings are two folders.
    expect(isInsideDirectory('/opt/Locust', '/opt/locust', 'linux')).toBe(false)
    expect(isInsideDirectory('/opt/locust/resources', '/opt/locust', 'linux')).toBe(true)
    // A sibling that merely shares the prefix is not inside.
    expect(isInsideDirectory('C:\\Users\\colin\\AppData\\Local\\Programs\\Locust2', INSTALL, 'win32')).toBe(false)
  })

  it('falls back to the folder chosen last time when launched from the install folder', () => {
    expect(
      resolveWorkspacePath({
        argv: [],
        cwd: INSTALL,
        installDirectory: INSTALL,
        remembered: 'C:\\work\\pebble',
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\work\\pebble', source: 'remembered' })
  })

  it('but a launch from a real folder beats the remembered one -- the person went there on purpose', () => {
    expect(
      resolveWorkspacePath({
        argv: [],
        cwd: 'C:\\work\\otter',
        installDirectory: INSTALL,
        remembered: 'C:\\work\\pebble',
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\work\\otter', source: 'launch-folder' })
  })

  it('takes an explicit --workspace argument over everything: that is how the app reopens in a chosen folder', () => {
    expect(
      resolveWorkspacePath({
        argv: ['Locust.exe', '--workspace=C:\\work\\pebble'],
        cwd: 'C:\\work\\otter',
        installDirectory: INSTALL,
        remembered: 'C:\\work\\heron',
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\work\\pebble', source: 'argument' })
  })

  it('ignores a relative or empty --workspace and a remembered path inside the install folder', () => {
    expect(
      resolveWorkspacePath({
        argv: ['--workspace=pebble'],
        cwd: 'C:\\work\\otter',
        installDirectory: INSTALL,
        remembered: undefined,
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\work\\otter', source: 'launch-folder' })
    expect(
      resolveWorkspacePath({
        argv: ['--workspace='],
        cwd: INSTALL,
        installDirectory: INSTALL,
        remembered: join(INSTALL, 'resources'),
        platform: 'win32'
      })
    ).toEqual({ path: undefined, source: 'none' })
  })

  it('has no install folder to avoid in a development build, so any launch folder is the workspace', () => {
    expect(
      resolveWorkspacePath({
        argv: ['electron', '.'],
        cwd: 'C:\\repo\\apps\\desktop',
        installDirectory: undefined,
        remembered: 'C:\\work\\pebble',
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\repo\\apps\\desktop', source: 'launch-folder' })
  })

  it('makes do with the default folder when nothing is chosen -- the way a terminal always has a cwd (Colin, 2026-09-05)', () => {
    expect(
      resolveWorkspacePath({
        argv: ['Locust.exe'],
        cwd: INSTALL,
        installDirectory: INSTALL,
        remembered: undefined,
        defaultWorkspace: 'C:\\Users\\colin\\Documents\\Locust',
        platform: 'win32'
      })
    ).toEqual({ path: 'C:\\Users\\colin\\Documents\\Locust', source: 'default' })
  })

  it('but a remembered folder beats the default, and a real launch folder beats both', () => {
    const remembered = resolveWorkspacePath({
      argv: ['Locust.exe'],
      cwd: INSTALL,
      installDirectory: INSTALL,
      remembered: 'C:\\work\\pebble',
      defaultWorkspace: 'C:\\Users\\colin\\Documents\\Locust',
      platform: 'win32'
    })
    expect(remembered).toEqual({ path: 'C:\\work\\pebble', source: 'remembered' })
    const launched = resolveWorkspacePath({
      argv: ['Locust.exe'],
      cwd: 'C:\\work\\other',
      installDirectory: INSTALL,
      remembered: 'C:\\work\\pebble',
      defaultWorkspace: 'C:\\Users\\colin\\Documents\\Locust',
      platform: 'win32'
    })
    expect(launched).toEqual({ path: 'C:\\work\\other', source: 'launch-folder' })
  })

  it('never defaults INTO the install folder, and a relative default is ignored', () => {
    for (const bad of [`${INSTALL}\\workspace`, 'Documents\\Locust']) {
      expect(
        resolveWorkspacePath({
          argv: ['Locust.exe'],
          cwd: INSTALL,
          installDirectory: INSTALL,
          remembered: undefined,
          defaultWorkspace: bad,
          platform: 'win32'
        })
      ).toEqual({ path: undefined, source: 'none' })
    }
  })

  it('gives the same folder the same id, and a different folder a different one', () => {
    expect(workspaceIdFor('C:\\work\\pebble')).toBe(workspaceIdFor('C:\\work\\pebble'))
    expect(workspaceIdFor('C:\\work\\pebble')).not.toBe(workspaceIdFor('C:\\work\\otter'))
    expect(workspaceIdFor('C:\\work\\pebble')).toMatch(/^ws_[0-9a-f]{32}$/)
  })
})

describe('the remembered folder', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'locust-ws-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips through its file', async () => {
    const file = join(dir, 'workspace.json')
    await writeRememberedWorkspace(file, 'C:\\work\\pebble')
    expect(readRememberedWorkspace(file)).toBe('C:\\work\\pebble')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ schemaVersion: 1, path: 'C:\\work\\pebble' })
  })

  it('is nothing when the file is missing, malformed, or empty -- never a crash at start-up', async () => {
    expect(readRememberedWorkspace(join(dir, 'missing.json'))).toBeUndefined()
    await writeFileRaw(join(dir, 'bad.json'), '{not json')
    expect(readRememberedWorkspace(join(dir, 'bad.json'))).toBeUndefined()
    await writeFileRaw(join(dir, 'empty.json'), '{"schemaVersion":1,"path":""}')
    expect(readRememberedWorkspace(join(dir, 'empty.json'))).toBeUndefined()
  })
})

async function writeFileRaw(file: string, text: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, text, 'utf8')
}
