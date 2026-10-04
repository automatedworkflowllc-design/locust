import { describe, expect, it } from 'vitest'

import type { FaceActivity } from './faceState.js'
import { lastWorkedPhrase, teamCardState } from './homeTeamState.js'
import type { TeammateStatusView } from './status.js'

/*
 * THE STATE ON A TEAM CARD (0.606): the same fact as the sidebar face,
 * worded for the card. A card used to say "working" or nothing.
 */
const view = (status: TeammateStatusView['status'], activity: FaceActivity, label = 'Code & Migrations · working', tone: TeammateStatusView['tone'] = 'live'): TeammateStatusView =>
  ({ status, activity, label, tone, pulse: false }) as TeammateStatusView
const NOW = new Date('2026-10-05T12:00:00.000Z')

describe('what a team card says beside the name', () => {
  it('says the live word while the teammate works', () => {
    expect(teamCardState(view('working', 'responding'))).toEqual({ word: 'replying', tone: 'live', spoken: 'replying now' })
    expect(teamCardState(view('working', 'thinking'))).toEqual({ word: 'thinking', tone: 'live', spoken: 'thinking now' })
  })

  it('says "waiting on you" in amber when a card asks', () => {
    expect(teamCardState(view('approval-needed', 'waiting', 'Money · waiting on you', 'amber'))).toEqual({ word: 'waiting on you', tone: 'amber', spoken: 'waiting on you' })
  })

  it('says what blocks the teammate, in red -- and nothing while the agent is still being checked', () => {
    expect(teamCardState(view('blocked', 'blocked', 'Sign-in needed', 'red'))).toEqual({ word: 'sign-in needed', tone: 'red', spoken: 'sign-in needed' })
    expect(teamCardState(view('blocked', 'blocked', 'AI agent not installed', 'red'))).toMatchObject({ word: 'AI agent not installed', tone: 'red' })
    // A moment, not a state: every card went amber for the seconds after launch while the strip said "checking".
    expect(teamCardState(view('blocked', 'blocked', 'AI agent not answering — checking again', 'amber'))).toBeUndefined()
  })

  it('says nothing beside the name of an idle teammate (0.609): the card is calm when they are', () => {
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'))).toBeUndefined()
  })

  it('keeps what they last did for the hover, in whole words', () => {
    expect(lastWorkedPhrase('2026-10-05T10:00:00.000Z', NOW)).toBe('last worked 2 hours ago')
    expect(lastWorkedPhrase('2026-10-01T10:00:00.000Z', NOW)).toBe('last worked 4 days ago')
    expect(lastWorkedPhrase('2026-10-05T11:59:30.000Z', NOW)).toBe('last worked just now')
    expect(lastWorkedPhrase(undefined, NOW)).toBe('no work yet')
  })

  it('says nothing for a teammate the app has no view of', () => {
    expect(teamCardState(undefined)).toBeUndefined()
  })
})
