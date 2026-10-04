import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { chooseFolderCaution, notATeammateFolder } from './workspace.js'

/*
 * A CHOSEN AGENT-SETTINGS FOLDER IS ASKED ABOUT (0.582).
 *
 * 0.572 stopped a LAUNCH from `.claude` becoming the workspace; a folder
 * picked in the window still had no word at all (handoff review finding d).
 * Picked on purpose it is the person's call -- Colin works in his `.claude`
 * on purpose -- so the picker asks, defaulting to choosing again.
 */

const HOME = 'C:\\Users\\person'

describe('choosing a folder that is no place for teammates', () => {
  it('says which folder it is and what a teammate would read there', () => {
    const why = notATeammateFolder(`${HOME}\\.claude`, HOME, 'win32')
    expect(why).toBe('.claude, where the agents keep their own settings')
    const caution = chooseFolderCaution(`${HOME}\\.claude`, why!)
    expect(caution.message).toBe('Work in .claude?')
    expect(caution.detail).toContain('This is .claude, where the agents keep their own settings.')
    expect(caution.detail).toContain('sign-in files')
    // Choosing again comes first: it is the default and the cancel.
    expect(caution.buttons).toEqual(['Choose another folder', 'Work here anyway'])
  })

  it('asks about home too, and nothing about a project folder (control)', () => {
    expect(notATeammateFolder(HOME, HOME, 'win32')).toBe('your home folder')
    // Copilot CLI's own folder joined the guard in 0.587.
    expect(notATeammateFolder(`${HOME}\\.copilot\\session-state`, HOME, 'win32')).toBe('.copilot, where the agents keep their own settings')
    expect(notATeammateFolder(`${HOME}\\Documents\\shop`, HOME, 'win32')).toBeUndefined()
  })

  it('is asked in the picker itself, and working there anyway is still possible', () => {
    // The main process is not importable in a test; its picker is read as text.
    const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const picker = main.slice(main.indexOf('ipcMain.handle(WORKSPACE_CHOOSE_CHANNEL'), main.indexOf('A QUESTION ON THE SIDE'))
    expect(picker).toContain('notATeammateFolder(next')
    expect(picker).toContain('chooseFolderCaution(next, why)')
    expect(picker).toMatch(/defaultId: 0, cancelId: 0/)
    expect(picker).toContain('if (answer.response === 1) break')
  })
})
