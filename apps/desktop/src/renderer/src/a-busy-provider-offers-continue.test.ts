import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'
import THREAD from './components/Thread.tsx?raw'
import { failedOnProviderSide } from './missionView.js'

/*
 * Colin, 2026-09-30: a Codex run stopped after 56 minutes with "Selected
 * model is at capacity. Please try a different model." -- "classic openai,
 * after an hour". The card offered nothing; typing "continue" carried the
 * same conversation on. Now the card offers Continue (0.511).
 */
describe('a run the provider dropped is offered Continue', () => {
  it('knows the provider was busy from what the runtime said', () => {
    expect(failedOnProviderSide({ message: 'Selected model is at capacity. Please try a different model.' })).toBe(true)
    expect(failedOnProviderSide({ message: 'The server is overloaded, try again later' })).toBe(true)
    expect(failedOnProviderSide({ message: 'stream disconnected before completion: error sending request' })).toBe(true)
    expect(failedOnProviderSide({ message: 'Codex invocation did not complete successfully', process: { stderr: 'ERROR: HTTP 503 Service Unavailable\n' } })).toBe(true)
  })

  it('and not a limit of the person\'s own, a sign-in, or anything else', () => {
    expect(failedOnProviderSide({ message: "You've hit your usage limit." , process: { stderr: 'ERROR: insufficient_quota\n' } })).toBe(false)
    expect(failedOnProviderSide({ message: 'Too many requests, rate limit exceeded' })).toBe(false)
    expect(failedOnProviderSide({ message: 'Your access token could not be refreshed. Please sign in again.' })).toBe(false)
    expect(failedOnProviderSide({ message: 'Codex invocation did not complete successfully' })).toBe(false)
    expect(failedOnProviderSide({})).toBe(false)
  })

  it('the card says it is the provider, and Continue sends into the same conversation', () => {
    expect(THREAD).toContain("The model's servers were busy: not your account, and nothing you did.")
    const app = APP
    expect(app).toContain("return () => void startMission('Continue from where you stopped.')")
    // Not offered beside the free-model switch, which already says what to do.
    expect(app).toMatch(/shown\.phase !== 'failed' \|\| shown\.data === undefined \|\| limitOffer !== undefined\) return undefined\s+const failed = \[\.\.\.shown\.events\][^\n]+\n\s+if \([^\n]+failedOnProviderSide/)
  })
})
