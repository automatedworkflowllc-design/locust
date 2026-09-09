import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RoutePicker, pickerEmptyMessage } from './components/RoutePicker.js'

/**
 * An empty model list is not an answer about the search.
 *
 * Found walking the packaged 0.54.0 build the way someone who had just
 * installed it would (2026-09-09). Open the picker, type `free`, and it said
 * **"Nothing matches that."** while the status line read "6 runtimes
 * connected". The model exists -- every other drive in this repository selects
 * it by that exact word -- but the catalog had not arrived yet, so the list
 * was empty and the picker reported that emptiness as a fact about the search.
 *
 * A person typing quickly is told a model does not exist. In that walkthrough
 * it silently sent the whole run to a different runtime, which is how it was
 * noticed at all: the receipt said Codex.
 *
 * It is the SAME defect 0.50.1 fixed on the effort chip -- "effort · fixed"
 * was drawn whenever the effort list was empty, which is also what an unloaded
 * catalog looks like. Two surfaces, one mistake: speaking from having no
 * information.
 */

describe('what the picker says when it is showing no rows', () => {
  it('does not blame the search when the catalog has not arrived', () => {
    // THE regression. No models at all: the search is not why the list is
    // empty, so a sentence about the search is a claim from no information.
    expect(pickerEmptyMessage(0)).toContain('Still reading the model list')
    expect(pickerEmptyMessage(0)).not.toContain('Nothing matches')
  })

  it('still blames the search when there genuinely is nothing like it', () => {
    /*
     * The control, and the reason this is two sentences rather than one.
     * With a catalog present "nothing matches" is true and useful; removing it
     * would trade a false claim for silence, which is not an improvement.
     */
    expect(pickerEmptyMessage(11)).toContain('Nothing matches that')
    expect(pickerEmptyMessage(11)).not.toContain('Still reading')
  })

  it('is what the picker actually renders, not just what the helper returns', () => {
    /*
     * The wiring, which is the half a helper test cannot see. With no runtimes
     * and no models there are no rows at all, so the empty branch renders --
     * and it must render the loading sentence rather than the search one.
     *
     * A first version of this file tried to reach the branch by passing a
     * search term, and there is no such prop: the picker keeps its query in
     * its own state. That is why the decision was extracted at all.
     */
    const html = renderToStaticMarkup(
      <RoutePicker
        runtimes={[]}
        models={[]}
        active={{ runtime: 'opencode', model: 'account-default' }}
        resolvedModels={new Map()}
        recentRoutes={[]}
        limitedRuntimes={new Map()}
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    )
    expect(html).toContain('Still reading the model list')
    expect(html).not.toContain('Nothing matches that')
  })
})
