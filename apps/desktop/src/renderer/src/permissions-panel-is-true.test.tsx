import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Inspector } from './components/Inspector.js'
import { sandboxPhrase } from './status.js'

/**
 * What a run was allowed to do, said the same way twice.
 *
 * The Inspector collapsed `workspace-write` and `full-access` into one
 * boolean, so an AUTO run -- the one that may touch the whole machine -- was
 * labelled `workspace-write` and then told the reader "deny: anything outside
 * the workspace", which is exactly what Auto is for. The conversation header
 * two inches away said "may edit anything on this machine".
 *
 * Of two surfaces a person trusts the specific-looking one, and it was the
 * wrong one. That is the worst shape a permissions panel can take: not vague,
 * but confidently inverted.
 */

const render = (sandbox: 'read-only' | 'workspace-write' | 'full-access', runtime = 'cursor', mode?: string): string =>
  renderToStaticMarkup(
    <Inspector
      events={[]}
      running={false}
      workspacePath={undefined}
      restoredMission={undefined}
      route={{ runtime, model: 'composer-2.5', sandbox, ...(mode === undefined ? {} : { mode }) } as never}
      onClose={() => undefined}
    />
  )

describe('the permissions panel', () => {
  it("speaks in Locust's words, not the plumbing's", () => {
    for (const sandbox of ['read-only', 'workspace-write', 'full-access'] as const) {
      expect(render(sandbox)).not.toMatch(/host-selected|argv|app-server|workspace folder/)
    }
  })

  it('is called what it is about, not "inspector" (0.361)', () => {
    const html = render('workspace-write')
    // What a person reads or hears: the text, and every aria-label.
    const words = [html.replace(/<[^>]+>/g, ' '), ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1] ?? '')].join(' ')
    expect(words).toContain('About this reply')
    expect(words).not.toMatch(/inspector/i)
  })

  it('never denies what Auto allows', () => {
    const auto = render('full-access')
    expect(auto).not.toContain('deny')
    expect(auto).toContain('anywhere your account can reach')
  })

  it('says what the header says, from the same function', () => {
    expect(render('full-access')).toContain(sandboxPhrase('full-access'))
    expect(render('workspace-write')).toContain(sandboxPhrase('workspace-write'))
    expect(render('read-only')).toContain(sandboxPhrase('read-only'))
  })

  it('still denies what a workspace-write run cannot do', () => {
    const scoped = render('workspace-write', 'opencode')
    expect(scoped).toContain('opening files outside this folder')
    expect(scoped).toContain('change files in this folder')
  })

  /*
   * THE PANEL UNDER A RUN THAT SEARCHED THE WEB (0.359).
   *
   * One sentence served every runtime, and for OpenCode -- the free model a
   * new person starts on -- it was false: "deny: ... any network access
   * beyond the model's own", under two "Searched the web" rows (the
   * first-session drive, packaged 0.358). What each runtime is given is
   * pinned against its real command in what-it-may-do-is-what-it-was-given.
   */
  it('says an OpenCode run may search the web, and no runtime is told a network rule it was not given', () => {
    expect(render('workspace-write', 'opencode')).toContain('search the web and open web pages')
    for (const runtime of ['codex', 'claude', 'cursor', 'opencode', 'copilot', 'muse', 'antigravity']) {
      for (const sandbox of ['read-only', 'workspace-write'] as const) {
        expect(render(sandbox, runtime)).not.toContain("beyond the model's own")
      }
    }
  })

  it("leaves the rest to the runtime's own settings, by name", () => {
    expect(render('workspace-write', 'antigravity')).toContain("Anything not listed is left to Antigravity&#x27;s own settings.")
  })

  it('says Approve each asks, rather than drawing Edit', () => {
    const asking = render('workspace-write', 'opencode', 'approve-each')
    expect(asking).toContain('once you approve each change')
    expect(asking).not.toContain('opening files outside this folder, other than')
  })

  it('still refuses every write for a read-only run', () => {
    expect(render('read-only')).toContain('changing any file')
  })
})
