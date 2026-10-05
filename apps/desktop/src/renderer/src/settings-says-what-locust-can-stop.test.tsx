/** 0.617, the PRD's R9: Settings > AI agents says which agents ask first, in the document's own words. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { runtimeDisplayName } from '../../shared/runtimes.js'
import { STOP_REACH_LABEL, WHAT_LOCUST_CAN_STOP } from '../../shared/what-locust-can-stop.js'
import { WhatLocustCanStop } from './components/WhatLocustCanStop.js'

describe('What Locust can stop, in Settings', () => {
  const html = renderToStaticMarkup(<WhatLocustCanStop />)

  it('is one folded row per AI agent, named, with how much a card can stop', () => {
    expect(html.match(/<details class="lc-stops__row"/g)).toHaveLength(WHAT_LOCUST_CAN_STOP.length)
    for (const row of WHAT_LOCUST_CAN_STOP) {
      expect(html).toContain(runtimeDisplayName(row.runtime))
      expect(html).toContain(STOP_REACH_LABEL[row.reach])
    }
    // Green only where each action can be stopped.
    expect(html.match(/lc-tag is-green/g)).toHaveLength(WHAT_LOCUST_CAN_STOP.filter((row) => row.reach === 'each-action').length)
  })

  it('opens to the same sentences the document holds', () => {
    // React escapes quotes; the sentences are compared as the page shows them.
    const shown = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    for (const row of WHAT_LOCUST_CAN_STOP) {
      expect(html).toContain(shown(row.asks))
      expect(html).toContain(shown(row.without))
      if (row.always !== undefined) expect(html).toContain(shown(row.always))
    }
    expect(html.match(/<dt>Always<\/dt>/g)).toHaveLength(WHAT_LOCUST_CAN_STOP.filter((row) => row.always !== undefined).length)
  })
})
