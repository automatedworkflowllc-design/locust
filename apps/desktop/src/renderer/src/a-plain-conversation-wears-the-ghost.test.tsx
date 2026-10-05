import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { AvatarSpec } from '../../shared/avatar.js'
import { AgentAvatar, LiveStepCard } from './components/ThreadItems.js'

/**
 * A PLAIN CONVERSATION WEARS THE GHOST (0.621).
 *
 * A message sent with nobody picked starts a conversation of nobody's, and
 * the thread still needs a face beside its replies and on its live row. That
 * face was Locust's own swarm mark. Colin, 2026-10-05: "lets make the default
 * teammate for now for a basic chat the ghost dude with terminal face, hes
 * just so much cleaner and better looking than the locust, we will touch the
 * locust up at some point". The ghost suits a screen (SCREEN_SHAPES), so with
 * Terminal faces on it wears one; off, it keeps its own eyes like every bot.
 * A teammate's own conversation is untouched: its face is its own.
 */
describe('a plain conversation wears the ghost', () => {
  const atlas: AvatarSpec = { ...seedAvatar('tm_atlas'), bot: { shape: 'droid', face: 'eyes' } }

  it('beside a reply: the ghost when the conversation is nobody\'s, the teammate\'s own bot when it has one', () => {
    const nobody = renderToStaticMarkup(<AgentAvatar size={24} />)
    expect(nobody).toContain('data-bot="ghost"')
    expect(nobody).not.toContain('data-bot="swarm"')
    const owned = renderToStaticMarkup(<AgentAvatar size={24} teammate={{ hue: 'blue', avatar: atlas }} />)
    expect(owned).toContain('data-bot="droid"')
    expect(owned).not.toContain('data-bot="ghost"')
  })

  it('on the live row: the same ghost while nobody\'s conversation thinks', () => {
    const html = renderToStaticMarkup(
      <LiveStepCard
        label="Thinking"
        detail={undefined}
        startedAt={new Date(0).toISOString()}
        kind="turn"
        register="thinking"
        waiting
        owner={undefined}
        activity="thinking"
      />
    )
    expect(html).toContain('data-bot="ghost"')
    expect(html).not.toContain('data-bot="swarm"')
  })
})
