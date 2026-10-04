import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AppUpdateState } from '../../shared/ipc.js'
import { INSTALL_TAKES, UpdateBanner, installingLine } from './components/Screens.js'

/**
 * AN UPDATE SAYS IT CLOSES AND OPENS AGAIN BY ITSELF (0.406).
 *
 * Colin, 2026-09-27: "my update doesnt seem to be working ... not sure what
 * happened". The install is silent; it took a few minutes, and meanwhile he
 * opened Locust three times and got the OLD version each time (his app's own
 * log: 0.402 at 11:28, 11:29, 11:30; 0.405 at 11:31). The banner now says what
 * a restart to install does before the click, and after it.
 */
const ready = { phase: 'ready', availableVersion: '0.406.0' } as unknown as AppUpdateState

describe('the update banner', () => {
  it('says, before the click, that Locust closes while it installs and opens again by itself', () => {
    const html = renderToStaticMarkup(<UpdateBanner update={ready} onInstall={async () => ({ ok: true, data: ready }) as never} />)
    expect(html).toContain('Locust 0.406.0 is downloaded and ready. Locust closes while it installs and opens again by itself in a minute or two.')
    expect(html).toContain('Restart and install')
  })

  it('has the words for after the click: installing, and no need to open it', () => {
    expect(INSTALL_TAKES).toBe('Locust closes while it installs and opens again by itself in a minute or two.')
    expect(installingLine('0.406.0')).toBe('Installing Locust 0.406.0. It opens again by itself in a minute or two; there is no need to open it.')
    expect(installingLine(undefined)).toBe('Installing Locust. It opens again by itself in a minute or two; there is no need to open it.')
  })
})
