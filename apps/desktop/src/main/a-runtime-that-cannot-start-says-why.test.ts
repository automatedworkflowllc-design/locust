import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { transportSentence } from './codex-mission.js'

/**
 * A RUNTIME THAT CANNOT START SAYS WHY, IN ITS OWN NAME (QA-2026-09-29 round 2, R25).
 *
 * Every failure read "The Codex process transport ended unexpectedly", for a
 * Claude run too, and said nothing about a program that was never started.
 */
describe('a runtime whose process failed', () => {
  const here = { runtime: 'claude' as const, cwd: tmpdir() }

  it('says its program was not found, and where to get it again', () => {
    expect(transportSentence(here, new Error('Runtime process failed to start (ENOENT)'))).toBe(
      'Claude Code could not be started: its program was not found. It may have been moved or uninstalled; Settings can install it again.'
    )
  })

  it('says the computer would not run it', () => {
    expect(transportSentence(here, new Error('Runtime process failed to start (EACCES)'))).toMatch(/^Claude Code could not be started: this computer did not allow/)
  })

  it('says the conversation\'s folder is gone, before anything else', () => {
    const gone = join(tmpdir(), 'locust-no-such-folder-9c1f')
    expect(transportSentence({ runtime: 'opencode', cwd: gone }, new Error('Runtime process failed to start (ENOENT)'))).toBe(
      `OpenCode could not start: the folder it works in, ${gone}, is not there any more.`
    )
  })

  it('names the runtime when it stopped rather than failed to start', () => {
    expect(transportSentence({ runtime: 'codex', cwd: tmpdir() }, new Error('stream closed'))).toBe('Codex CLI stopped unexpectedly, before it said it had finished.')
  })
})
