import { describe, expect, it } from 'vitest'

import { claudeToolTitle, openCodeToolTitle } from '@teammate/runtime-adapters'

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

  it('reaches OpenCode too, which is the runtime anyone can actually run', () => {
    /*
     * I shipped 0.56.0 saying command rows read as intent "where the runtime
     * reports it -- Claude Code and OpenCode do". Only Claude Code did. The
     * claim was false in a published changelog for about an hour.
     *
     * OpenCode's bash tool does carry a description, and openCodeToolTarget
     * already reaches for it -- but only after filePath and command, so a
     * shell call never got there. Fixed rather than the claim, because
     * OpenCode is the free runtime and therefore the only one this can be
     * verified on without spending anything.
     */
    expect(openCodeToolTitle('bash', { command: 'ls -la', description: 'List the release assets' })).toBe(
      'List the release assets'
    )
    expect(openCodeToolTitle('bash', { command: 'ls -la' })).toBeUndefined()
    // A file tool's row is already the path, which reads better than a
    // sentence about it; `task` has used the description as its own text
    // since before this existed.
    expect(openCodeToolTitle('read', { filePath: '/x', description: 'read it' })).toBeUndefined()
    expect(openCodeToolTitle('task', { description: 'go and look' })).toBeUndefined()
  })
})

