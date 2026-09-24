import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicModel, PublicTeammate, TeammateRoute } from '../../shared/ipc.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'

/**
 * A TEAMMATE'S MODEL, SET FROM THEIR DIALOG (0.311).
 *
 * Colin, 2026-09-24: "do we have the ability to switch a teammates model? like
 * not when youre in the chat but the actual designated teammate". It changed
 * only when a message was sent to them on another model; the dialog said
 * "Whichever route is active when a mission starts".
 */
const noop = (): void => undefined
const wren = {
  teammateId: 'tm_wren',
  name: 'Wren',
  hue: 'lime',
  role: 'Code & Migrations',
  avatar: { shape: 'classic', eyes: 'dots', antenna: 'single', mouth: 'smile' },
  createdAt: '2026-09-05T05:00:00.000Z'
} as unknown as PublicTeammate
const chatBox: TeammateRoute = { runtime: 'claude', model: 'sonnet', mode: 'accept-edits' }
const picker = { runtimes: [], models: [], resolvedModels: new Map<string, string>(), recentRoutes: [], limitedRuntimes: new Map<string, string>() }

describe('the Model row', () => {
  it('names the model the teammate runs on, and offers the chat’s own picker', () => {
    const html = renderToStaticMarkup(
      <NewTeammateDialog
        initial={{ ...wren, route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'ask', effort: 'low' } }}
        mode="accept-edits"
        error={undefined}
        onCancel={noop}
        onCreate={noop}
        composerRoute={chatBox}
        picker={picker}
      />
    )
    expect(html).toContain('lc-teammatemodel__name')
    expect(html).toMatch(/Codex \/ GPT-6[- ]Luna/)
    expect(html).toContain('>Change</button>')
    expect(html).not.toContain('Whichever route is active when a mission starts')
  })

  it('says a teammate with none of its own takes the chat box’s until one is picked', () => {
    const html = renderToStaticMarkup(
      <NewTeammateDialog mode="accept-edits" error={undefined} onCancel={noop} onCreate={noop} composerRoute={chatBox} picker={picker} />
    )
    expect(html).toContain('the chat box&#x27;s, until you pick one')
  })

  it('offers nothing to press when there is no picker to open', () => {
    const html = renderToStaticMarkup(
      <NewTeammateDialog initial={wren} mode="accept-edits" error={undefined} onCancel={noop} onCreate={noop} composerRoute={chatBox} />
    )
    expect(html).not.toContain('>Change</button>')
  })
})

/**
 * AND ITS EFFORT (Colin, 2026-09-24: "for model picker in edit teammate we
 * need to be able to choose effort too"). The route always carried a level;
 * the dialog showed none, so a teammate's effort changed only in a chat.
 */
const luna = {
  id: 'gpt-6-luna',
  runtime: 'codex',
  displayName: 'GPT-6 Luna',
  supportedEfforts: ['low', 'medium', 'high', 'xhigh']
} as unknown as PublicModel
const withModels = { ...picker, models: [luna] as readonly PublicModel[] }
const draw = (route: TeammateRoute | undefined, models = withModels): string =>
  renderToStaticMarkup(
    <NewTeammateDialog
      initial={route === undefined ? wren : { ...wren, route }}
      mode="accept-edits"
      error={undefined}
      onCancel={noop}
      onCreate={noop}
      composerRoute={chatBox}
      picker={models}
    />
  )

describe('the Effort row', () => {
  it('states the teammate’s own level on the composer’s slider, with this model’s stops', () => {
    const html = draw({ runtime: 'codex', model: 'gpt-6-luna', mode: 'ask', effort: 'high' })
    expect(html).toContain('lc-teammatemodel__effort')
    expect(html).toMatch(/lc-effortpanel__now">High</)
    expect(html.match(/lc-effortpanel__notch[ "]/g)).toHaveLength(4)
    expect(html).toMatch(/lc-effortpanel__slider[^>]*value="2"/)
  })

  it('says the model’s default when the teammate has no level of its own', () => {
    expect(draw({ runtime: 'codex', model: 'gpt-6-luna', mode: 'ask' })).toMatch(/lc-effortpanel__now">Medium</)
  })

  it('is not offered for a model that reports no levels', () => {
    const fixed = { ...withModels, models: [{ ...luna, supportedEfforts: [] }] as readonly PublicModel[] }
    expect(draw({ runtime: 'codex', model: 'gpt-6-luna', mode: 'ask' }, fixed)).not.toContain('lc-teammatemodel__effort')
  })
})
