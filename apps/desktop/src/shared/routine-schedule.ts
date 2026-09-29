/**
 * When a routine runs on its own.
 *
 * Two shapes, both local and both only while the app is open (the parity
 * map's own bound for a desktop product): every N hours from the last run,
 * or daily at a wall-clock time. Nothing here starts anything; the runner
 * asks `nextRunAfter` and starts a routine whose next run has passed. A
 * routine with no schedule is what every routine was before this: it runs
 * when a person presses Run.
 */

export type RoutineSchedule =
  | { readonly kind: 'every'; readonly hours: number }
  | { readonly kind: 'daily'; readonly at: string }

export const EVERY_HOURS_CHOICES = [1, 2, 4, 8, 12, 24] as const
export const MAX_EVERY_HOURS = 168

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validSchedule(value: unknown): value is RoutineSchedule {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.kind === 'every') {
    return typeof record.hours === 'number' && Number.isInteger(record.hours) && record.hours >= 1 && record.hours <= MAX_EVERY_HOURS
  }
  if (record.kind === 'daily') {
    return typeof record.at === 'string' && TIME.test(record.at)
  }
  return false
}

/**
 * The next moment a routine is due, given when it last ran (or was made)
 * and what time it is now.
 *
 * `every`: the last run plus the interval; if that has already passed, now
 * -- a routine that missed several intervals while the app was closed runs
 * once, not once per missed interval.
 * `daily`: today at the wall-clock time if it is still ahead and the last
 * run was before it; otherwise tomorrow at that time.
 */
export function nextRunAfter(schedule: RoutineSchedule, lastRunAt: string, now: Date): Date {
  const last = new Date(lastRunAt)
  if (schedule.kind === 'every') {
    const due = new Date(last.getTime() + schedule.hours * 3_600_000)
    return due.getTime() <= now.getTime() ? now : due
  }
  const [hours, minutes] = schedule.at.split(':').map((part) => Number(part)) as [number, number]
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
  // Already ran today at or after the slot: tomorrow.
  if (last.getTime() >= today.getTime()) {
    // Tomorrow's slot on the calendar, not today's plus 24 hours: on the day
    // the clocks change a day is 23 or 25 hours, and "daily at 09:00" ran at
    // 10:00 or 08:00 (QA-2026-09-29 round 2, R7).
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours, minutes, 0, 0)
  }
  // The slot is still ahead today, or passed without a run: today's slot
  // (which, if passed, is "now" to the runner).
  return today
}

export function isDue(schedule: RoutineSchedule, lastRunAt: string, now: Date): boolean {
  return nextRunAfter(schedule, lastRunAt, now).getTime() <= now.getTime()
}

/** How the schedule reads on a card. */
export function scheduleLabel(schedule: RoutineSchedule | undefined): string {
  if (schedule === undefined) return 'when you press Run'
  if (schedule.kind === 'every') return schedule.hours === 1 ? 'every hour' : `every ${String(schedule.hours)} hours`
  return `daily at ${schedule.at}`
}
