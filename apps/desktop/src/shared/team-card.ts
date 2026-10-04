import type { AvatarSpec } from './avatar.js'
import type { PublicTeammate, TeammateHue, TeammateRole, TeammateRoute } from './ipc.js'

/**
 * A TEAM, SHARED AS A PICTURE OF ITSELF (0.398).
 *
 * From the rooms-and-peers research (item 8): Buzz imports a team as
 * `.team.png`, and persona apps have passed characters around as PNG cards
 * for years. A Locust team card is an image of the team -- faces, names,
 * roles, the model each runs -- that also carries the team as data, so
 * dropping it into another Locust makes the same teammates.
 *
 * DATA ONLY, and less than the roster holds. No ids, no conversations, no
 * memories, no spending limits, no folders; a model of the person's OWN
 * (`own-…`) is left out, because it names an address and a key on this
 * machine. On the way in every field is checked again by the store, and a
 * route in Auto -- the mode that runs without asking and outside the folder
 * -- comes in as Edit: a picture from someone else never widens what a
 * teammate may do.
 */
export const TEAM_CARD_KEYWORD = 'locust-team'
export const MAX_TEAM_CARD_TEAMMATES = 12

export interface TeamCardTeammate {
  readonly name: string
  readonly role: TeammateRole
  readonly roleTitle?: string
  readonly hue: TeammateHue
  readonly avatar?: AvatarSpec
  readonly route?: TeammateRoute
}

export interface TeamCard {
  readonly schema: 1
  readonly teammates: readonly TeamCardTeammate[]
}

const ownModel = (model: string): boolean => /^own-[a-z0-9]+\//i.test(model)

/** What a card carries for these teammates. */
export function teamCardOf(teammates: readonly PublicTeammate[]): TeamCard {
  return {
    schema: 1,
    teammates: teammates.slice(0, MAX_TEAM_CARD_TEAMMATES).map((teammate) => ({
      name: teammate.name,
      role: teammate.role,
      ...(teammate.roleTitle === undefined ? {} : { roleTitle: teammate.roleTitle }),
      hue: teammate.hue,
      ...(teammate.avatar === undefined ? {} : { avatar: teammate.avatar }),
      ...(teammate.route === undefined || ownModel(teammate.route.model)
        ? {}
        : { route: { runtime: teammate.route.runtime, model: teammate.route.model, mode: teammate.route.mode, ...(teammate.route.effort === undefined ? {} : { effort: teammate.route.effort }) } })
    }))
  }
}

/**
 * The card's teammates, as far as they can be read. Shape only: every field
 * is checked again when the store makes the teammate. Undefined when this is
 * not a Locust team card at all.
 */
export function readTeamCard(value: unknown): readonly Record<string, unknown>[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const card = value as Record<string, unknown>
  if (card.schema !== 1 || !Array.isArray(card.teammates)) return undefined
  return card.teammates
    .slice(0, MAX_TEAM_CARD_TEAMMATES)
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => {
      const route = typeof entry.route === 'object' && entry.route !== null ? (entry.route as Record<string, unknown>) : undefined
      // Auto never arrives from a picture; the person turns it on themselves.
      const safeRoute = route === undefined ? undefined : { ...route, mode: route.mode === 'auto' ? 'accept-edits' : route.mode }
      return { ...entry, ...(safeRoute === undefined ? {} : { route: safeRoute }) }
    })
}

/** A name not already on the roster: "Wren", else "Wren 2", "Wren 3". */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((entry) => entry.toLowerCase()))
  if (!lower.has(name.toLowerCase())) return name
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${name} ${String(n)}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
  return `${name} ${String(Date.now() % 1000)}`
}
