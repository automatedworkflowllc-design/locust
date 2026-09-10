import { describe, expect, it } from 'vitest'

import { claudeToolTitle } from '@teammate/runtime-adapters'

/**
 * A command row leads with what the model said it was doing.
 *
 * Colin, 2026-09-09, showing Claude Code's own transcript: "look into how
 * claude code does this and see if you can replicate it on any of the
 * models... figured you might have a unique perspective since you actually
 * run out of this app."
 *
 * The perspective turns out to be the answer. Claude Code's Bash tool takes
 * a `description` next to the command -- "Clear, concise description of what
 * this command does in active voice" -- and the model fills it in on every
 * call. That field is the entire reason its transcript reads "Checked what
 * the app says about the free route" where a lesser one reads a grep
 * pipeline. It is not derived from the command and it cannot be: it is
 * intent, and only the caller knows it.
 *
 * Locust had the field arriving and threw it away. `claudeToolTarget`
 * answered the COMMAND for Bash and nothing looked at the input again -- so
 * every command row drew the pipeline. Two cases below it, `Task` already
 * preferred the description, with a comment saying "the description is the
 * row's text". The pattern was known and simply never applied to the tool
 * that runs most often.
 *
 * Which runtimes this reaches, checked rather than assumed:
 *
 *   Claude Code   yes -- `description` on every Bash call
 *   OpenCode      yes -- already read, but only after `command`
 *   Codex         NO  -- no such field anywhere in its stream
 *
 * So this is not "make the rows nicer". It is: stop discarding a sentence
 * the model already wrote, on the two runtimes that write one.
 */

describe('what a Bash row says it was doing', () => {
  it('takes the model’s own description', () => {
    expect(
      claudeToolTitle('Bash', { command: 'grep -rn "contributor" apps/', description: 'Check what the app says about the free route' })
    ).toBe('Check what the app says about the free route')
  })

  it('has nothing to say when the model wrote nothing', () => {
    // THE case that must stay unchanged. Codex sends no description at all,
    // and a row with no sentence has to go on showing the command rather
    // than showing an empty space where one would have been.
    expect(claudeToolTitle('Bash', { command: 'ls' })).toBeUndefined()
    expect(claudeToolTitle('Bash', { command: 'ls', description: '' })).toBeUndefined()
    expect(claudeToolTitle('Bash', undefined)).toBeUndefined()
  })

  it('is only for commands', () => {
    /*
     * A file tool's row is already the path, which is the better thing to
     * show -- "Created RUNTIMES-...md +75 -0" reads on its own. And `Task`
     * has preferred the description since before this existed; taking it
     * over here would give one tool two owners.
     */
    expect(claudeToolTitle('Read', { file_path: '/x', description: 'read it' })).toBeUndefined()
    expect(claudeToolTitle('Task', { description: 'go and look' })).toBeUndefined()
  })
})
