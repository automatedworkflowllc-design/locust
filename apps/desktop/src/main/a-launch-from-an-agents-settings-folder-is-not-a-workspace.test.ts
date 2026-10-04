import { describe, expect, it } from 'vitest'

import { notATeammateFolder, resolveWorkspacePath } from './workspace.js'

/*
 * A LAUNCH FROM AN AGENT'S SETTINGS FOLDER IS NOT A WORKSPACE (0.572).
 *
 * Colin's ledger, 2026-10-03: Bro worked in C:\Users\<name>\.claude --
 * Claude Code's own folder. In Auto its first command listed the credential
 * files there. A launch folder was taken as the workspace whatever it was;
 * the install folder was the only one refused.
 */

const HOME = 'C:\\Users\\person'
const base = {
  argv: [] as string[],
  installDirectory: 'C:\\Users\\person\\AppData\\Local\\Programs\\Locust',
  remembered: 'C:\\Users\\person\\Documents\\Codex\\project',
  defaultWorkspace: 'C:\\Users\\person\\Documents\\Locust',
  platform: 'win32' as const,
  homeDirectory: HOME,
  systemDirectory: 'C:\\Windows'
}

describe('a launch folder no teammate should work in', () => {
  it.each([
    ['Claude Code\'s folder', 'C:\\Users\\person\\.claude'],
    ['inside it', 'C:\\Users\\person\\.claude\\projects'],
    ['Codex\'s folder', 'C:\\Users\\person\\.codex'],
    ['Cursor\'s folder', 'C:\\Users\\person\\.cursor'],
    ['Gemini\'s folder', 'C:\\Users\\person\\.gemini'],
    ['Copilot\'s folder', 'C:\\Users\\person\\.copilot'],
    ['the home folder itself', 'C:\\Users\\person'],
    ['above home', 'C:\\Users'],
    ['Windows\' own folder', 'C:\\Windows\\System32'],
    ['any case', 'c:\\users\\PERSON\\.Claude']
  ])('%s falls back to the folder chosen last time', (_name, cwd) => {
    expect(resolveWorkspacePath({ ...base, cwd })).toEqual({ path: base.remembered, source: 'remembered' })
  })

  it('with none chosen, falls back to the folder Locust makes', () => {
    expect(resolveWorkspacePath({ ...base, remembered: undefined, cwd: 'C:\\Users\\person\\.claude' })).toEqual({ path: base.defaultWorkspace, source: 'default' })
  })

  it('names why, for a person', () => {
    expect(notATeammateFolder('C:\\Users\\person\\.claude', HOME, 'win32')).toBe('.claude, where the agents keep their own settings')
    expect(notATeammateFolder(HOME, HOME, 'win32')).toBe('your home folder')
  })
})

describe('a launch folder that is a project', () => {
  it.each([
    ['a project in Documents', 'C:\\Users\\person\\Documents\\Codex\\locust'],
    ['a folder beside .claude with a similar name', 'C:\\Users\\person\\.claude-projects'],
    ['a project under home', 'C:\\Users\\person\\work'],
    ['a comparison copy Locust made', 'C:\\Users\\person\\.locust\\compare\\cmp_1-a']
  ])('%s is still the workspace', (_name, cwd) => {
    expect(resolveWorkspacePath({ ...base, cwd })).toEqual({ path: cwd, source: 'launch-folder' })
  })

  it('an explicit folder argument still wins, whatever it is', () => {
    expect(resolveWorkspacePath({ ...base, argv: ['--workspace=C:\\Users\\person\\.claude'], cwd: 'C:\\x' })).toEqual({ path: 'C:\\Users\\person\\.claude', source: 'argument' })
  })
})
