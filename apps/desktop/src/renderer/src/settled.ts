/**
 * SETTLE AND SNOOZE (0.730): the plan's "Settle, snooze and pin conversations -- finished work moves out of the
 * way; a conversation can come back at a set time", after pinning (0.729).
 *
 * A settled conversation leaves the sidebar; a snoozed one leaves it until its time. Either comes back by itself
 * when something new happens in it, and a search, the Conversations screen, or opening it still finds it, where
 * its menu brings it back. Nothing is deleted or moved: only the sidebar's list is shorter.
 */
export interface SettledEntry {
  readonly at: string
  readonly until?: string
}

/** Whether the sidebar leaves this conversation out right now. */
export function isPutAway(lastAt: string | undefined, entry: SettledEntry | undefined, now: Date): boolean {
  if (entry === undefined) return false
  // Something happened in it since: back.
  if (lastAt !== undefined && Date.parse(lastAt) > Date.parse(entry.at)) return false
  return entry.until === undefined || Date.parse(entry.until) > now.getTime()
}

export interface SnoozeChoice {
  readonly label: string
  /** ISO. */
  readonly until: string
}

const at = (base: Date, days: number, hour: number): Date => {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  next.setHours(hour, 0, 0, 0)
  return next
}

/** The times a conversation can be snoozed until, from now, in the person's own clock. */
export function snoozeChoices(now: Date): readonly SnoozeChoice[] {
  const choices: SnoozeChoice[] = [{ label: 'For an hour', until: new Date(now.getTime() + 60 * 60_000).toISOString() }]
  // This evening only while it is still a while away.
  if (now.getHours() < 17) choices.push({ label: 'Until this evening (6 PM)', until: at(now, 0, 18).toISOString() })
  choices.push({ label: 'Until tomorrow (9 AM)', until: at(now, 1, 9).toISOString() })
  // Next Monday: a Monday's own is a week away.
  const toMonday = ((8 - now.getDay()) % 7) || 7
  if (toMonday > 1) choices.push({ label: 'Until Monday (9 AM)', until: at(now, toMonday, 9).toISOString() })
  return choices
}
