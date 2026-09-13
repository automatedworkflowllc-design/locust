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

const render = (sandbox: 'read-only' | 'workspace-write' | 'full-access'): string =>
  renderToStaticMarkup(
    <Inspector
      events={[]}
      running={false}
      workspacePath={undefined}
      restoredMission={undefined}
      route={{ runtime: 'cursor', model: 'composer-2.5', sandbox } as never}
      onClose={() => undefined}
    />
  )

describe('the permissions panel', () => {
  it('never denies what Auto allows', () => {
    const auto = render('full-access')
    expect(auto).not.toContain('deny')
    expect(auto).toContain('anywhere this account can reach')
  })

  it('says what the header says, from the same function', () => {
    expect(render('full-access')).toContain(sandboxPhrase('full-access'))
    expect(render('workspace-write')).toContain(sandboxPhrase('workspace-write'))
    expect(render('read-only')).toContain(sandboxPhrase('read-only'))
  })

  it('still denies what a workspace-write run cannot do', () => {
    const scoped = render('workspace-write')
    expect(scoped).toContain('anything outside the workspace')
    expect(scoped).toContain('inside that same workspace folder')
  })

  it('still refuses every write for a read-only run', () => {
    expect(render('read-only')).toContain('every write to disk')
  })
})
