import { describe, expect, it } from 'vitest'

import { recipientOf } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A share addressed to the sender's own role is not a roster problem.
 *
 * Colin, 2026-09-09, from a mission running in his `.claude` folder: the
 * thread carried `Jimothy addressed a message to "Finance Bro", who is not on
 * the roster. Nothing was sent.` -- and "Finance Bro" is Jimothy's OWN role.
 * The briefing prints the roster as `Jimothy (Finance Bro)`, the model took
 * the half it was not meant to take, and the app reported a missing teammate
 * the person could go and add. There was nothing to add.
 *
 * Third variation of one defect. Single quotes on `to=` matched nothing;
 * the printed `(Role)` suffix matched nothing; now the role alone. All three
 * are the app failing to read something unambiguous, and the first two are
 * already handled in `peer-share.ts`.
 *
 * The role is a way IN, not a free-for-all: several teammates can be
 * `Custom`, and delivering to whichever came first would be worse than a
 * refusal said out loud.
 */

const peer = (self: { name: string; role: string }, others: readonly { name: string; role: string }[]): MissionPeerContext =>
  ({
    self: { teammateId: 'tm_self', ...self },
    others: others.map((entry, index) => ({ teammateId: `tm_${String(index)}`, ...entry }))
  }) as unknown as MissionPeerContext

const JIMOTHY = peer({ name: 'Jimothy', role: 'Finance Bro' }, [
  { name: 'Wren', role: 'Code & Migrations' },
  { name: 'Gem', role: 'Custom' }
])

describe('who a share block meant', () => {
  it('is the sender itself when it used its own role', () => {
    expect(recipientOf('Finance Bro', JIMOTHY)).toBe('self')
    expect(recipientOf('finance bro', JIMOTHY)).toBe('self')
    expect(recipientOf('Jimothy', JIMOTHY)).toBe('self')
  })

  it('is a teammate named, however it was cased', () => {
    expect(recipientOf('Wren', JIMOTHY)).toMatchObject({ name: 'Wren' })
    expect(recipientOf('  gem  ', JIMOTHY)).toMatchObject({ name: 'Gem' })
  })

  it('is a teammate found by their role, when exactly one answers to it', () => {
    expect(recipientOf('Code & Migrations', JIMOTHY)).toMatchObject({ name: 'Wren' })
    expect(recipientOf('Custom', JIMOTHY)).toMatchObject({ name: 'Gem' })
  })

  it('is nobody when a role is shared, rather than whoever came first', () => {
    const crowded = peer({ name: 'Jimothy', role: 'Finance Bro' }, [
      { name: 'Gem', role: 'Custom' },
      { name: 'Fen', role: 'Custom' }
    ])
    expect(recipientOf('Custom', crowded)).toBeUndefined()
  })

  it('is nobody for a name nothing on the roster answers to', () => {
    expect(recipientOf('Mallory', JIMOTHY)).toBeUndefined()
    expect(recipientOf('', JIMOTHY)).toBeUndefined()
    expect(recipientOf('   ', JIMOTHY)).toBeUndefined()
  })

  it('prefers a real teammate over the sender, when a name is worn twice', () => {
    // A teammate genuinely called after someone's role must still be
    // reachable: the person named them that, and the message has somewhere
    // real to go.
    const clash = peer({ name: 'Jimothy', role: 'Finance Bro' }, [{ name: 'Finance Bro', role: 'Docs & QA' }])
    expect(recipientOf('Finance Bro', clash)).toMatchObject({ name: 'Finance Bro' })
  })
})
