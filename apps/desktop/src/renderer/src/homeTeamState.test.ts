import { describe, expect, it } from 'vitest'

import type { FaceActivity } from './faceState.js'
import { teamCardState } from './homeTeamState.js'
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
    expect(teamCardState(view('working', 'responding'), '2026-10-05T11:00:00.000Z', NOW)).toEqual({ word: 'replying', tone: 'live', spoken: 'replying now' })
    expect(teamCardState(view('working', 'thinking'), undefined, NOW)).toEqual({ word: 'thinking', tone: 'live', spoken: 'thinking now' })
  })

  it('says "waiting on you" in amber when a card asks', () => {
    expect(teamCardState(view('approval-needed', 'waiting', 'Money · waiting on you', 'amber'), undefined, NOW)).toEqual({ word: 'waiting on you', tone: 'amber', spoken: 'waiting on you' })
  })

  it('says what blocks the teammate, in red, or amber while the agent is checked again', () => {
    expect(teamCardState(view('blocked', 'blocked', 'Sign-in needed', 'red'), undefined, NOW)).toEqual({ word: 'sign-in needed', tone: 'red', spoken: 'sign-in needed' })
    expect(teamCardState(view('blocked', 'blocked', 'AI agent not installed', 'red'), undefined, NOW)).toMatchObject({ word: 'AI agent not installed', tone: 'red' })
    expect(teamCardState(view('blocked', 'blocked', 'AI agent not answering — checking again', 'amber'), undefined, NOW)).toEqual({ word: 'AI agent not answering', tone: 'amber', spoken: 'AI agent not answering' })
  })

  it('says when an idle teammate last worked -- short on the card, whole when read aloud -- or that they have not yet', () => {
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'), '2026-10-05T10:00:00.000Z', NOW)).toEqual({ word: '2h ago', tone: 'muted', spoken: 'last worked 2 hours ago' })
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'), '2026-10-01T10:00:00.000Z', NOW)).toEqual({ word: '4d ago', tone: 'muted', spoken: 'last worked 4 days ago' })
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'), '2026-09-10T10:00:00.000Z', NOW)).toMatchObject({ word: '3w ago' })
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'), '2026-10-05T11:59:30.000Z', NOW)).toEqual({ word: 'just now', tone: 'muted', spoken: 'last worked just now' })
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'), '2026-10-05T11:45:00.000Z', NOW)).toMatchObject({ word: '15m ago' })
    expect(teamCardState(view('idle', 'idle', 'Docs & QA · idle', 'muted'), undefined, NOW)).toEqual({ word: 'no work yet', tone: 'muted', spoken: 'no work yet' })
  })

  it('says nothing for a teammate the app has no view of', () => {
    expect(teamCardState(undefined, undefined, NOW)).toBeUndefined()
  })
})
