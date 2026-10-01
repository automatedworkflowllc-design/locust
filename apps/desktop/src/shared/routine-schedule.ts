/**
 * When a routine runs on its own.
 *
 * Four shapes, all local and all only while the app is open (the parity
 * map's own bound for a desktop product): every N hours from the last run,
 * daily at a wall-clock time, on chosen days of the week at a time (0.517),
 * or once at a date and time (0.517). Nothing here starts anything; the
 * runner asks `nextRunAfter` and starts a routine whose next run has passed.
 * A routine with no schedule is what every routine was before this: it runs
 * when a person presses Run.
 */

export type RoutineSchedule =
  | { readonly kind: 'every'; readonly hours: number }
  | { readonly kind: 'daily'; readonly at: string }
  /** `days`: 0 is Sunday, as `Date.getDay()` counts; sorted, no repeats, at least one. */
  | { readonly kind: 'weekly'; readonly days: readonly number[]; readonly at: string }
  /** `on`: a local date and time, `YYYY-MM-DDTHH:MM`, as a datetime-local input gives it. */
  | { readonly kind: 'once'; readonly on: string }

export const EVERY_HOURS_CHOICES = [1, 2, 4, 8, 12, 24] as const
export const MAX_EVERY_HOURS = 168
/** Monday to Friday: what "On set days" starts with. */
export const WEEKDAYS_ONLY: readonly number[] = [1, 2, 3, 4, 5]

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const LOCAL_MOMENT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/

/** A `once` moment as a Date in the person's clock, or undefined when it is not a real date. */
export function onceMoment(on: string): Date | undefined {
  const match = LOCAL_MOMENT.exec(on)
  if (match === null) return undefined
  const [year, month, day, hours, minutes] = match.slice(1).map((part) => Number(part)) as [number, number, number, number, number]
  const moment = new Date(year, month - 1, day, hours, minutes, 0, 0)
  // 2026-02-30 rolls over to March: not a date anyone picked.
  if (moment.getFullYear() !== year || moment.getMonth() !== month - 1 || moment.getDate() !== day) return undefined
  return moment
}

export function validSchedule(value: unknown): value is RoutineSchedule {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.kind === 'every') {
    return typeof record.hours === 'number' && Number.isInteger(record.hours) && record.hours >= 1 && record.hours <= MAX_EVERY_HOURS
  }
  if (record.kind === 'daily') {
    return typeof record.at === 'string' && TIME.test(record.at)
  }
  if (record.kind === 'weekly') {
    const days = record.days
    return (
      typeof record.at === 'string' &&
      TIME.test(record.at) &&
      Array.isArray(days) &&
      days.length >= 1 &&
      days.every((day, index) => Number.isInteger(day) && day >= 0 && day <= 6 && (index === 0 || day > (days[index - 1] as number)))
    )
  }
  if (record.kind === 'once') {
    return typeof record.on === 'string' && onceMoment(record.on) !== undefined
  }
  return false
}

const slotOn = (now: Date, dayOffset: number, at: string): Date => {
  const [hours, minutes] = at.split(':').map((part) => Number(part)) as [number, number]
  // A calendar day, not 24 hours: on the day the clocks change a day is 23
  // or 25 hours, and "09:00" would land at 10:00 or 08:00 (QA-2026-09-29
  // round 2, R7).
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hours, minutes, 0, 0)
}

/**
 * The next moment a routine is due, given when it last ran (or was made)
 * and what time it is now; undefined when it will not run again (a `once`
 * that has run).
 *
 * `every`: the last run plus the interval; if that has already passed, now
 * -- a routine that missed several intervals while the app was closed runs
 * once, not once per missed interval.
 * `daily`: today at the wall-clock time if it is still ahead and the last
 * run was before it; otherwise tomorrow at that time.
 * `weekly`: the latest chosen-day slot that has passed, if the routine has
 * not run since (a missed run happens once, as the dialog promises);
 * otherwise the next chosen-day slot.
 * `once`: the moment, until it has run at or after it.
 */
export function nextRunAfter(schedule: RoutineSchedule, lastRunAt: string, now: Date): Date | undefined {
  const last = new Date(lastRunAt)
  if (schedule.kind === 'every') {
    const due = new Date(last.getTime() + schedule.hours * 3_600_000)
    return due.getTime() <= now.getTime() ? now : due
  }
  if (schedule.kind === 'once') {
    const moment = onceMoment(schedule.on)
    if (moment === undefined || last.getTime() >= moment.getTime()) return undefined
    return moment
  }
  if (schedule.kind === 'weekly') {
    const slots: Date[] = []
    for (let offset = -7; offset <= 7; offset += 1) {
      const slot = slotOn(now, offset, schedule.at)
      if (schedule.days.includes(slot.getDay())) slots.push(slot)
    }
    const passed = slots.filter((slot) => slot.getTime() <= now.getTime())
    const latest = passed[passed.length - 1]
    if (latest !== undefined && last.getTime() < latest.getTime()) return latest
    return slots.find((slot) => slot.getTime() > now.getTime() && slot.getTime() > last.getTime())
  }
  const today = slotOn(now, 0, schedule.at)
  // Already ran today at or after the slot: tomorrow.
  if (last.getTime() >= today.getTime()) return slotOn(now, 1, schedule.at)
  // The slot is still ahead today, or passed without a run: today's slot
  // (which, if passed, is "now" to the runner).
  return today
}

export function isDue(schedule: RoutineSchedule, lastRunAt: string, now: Date): boolean {
  const next = nextRunAfter(schedule, lastRunAt, now)
  return next !== undefined && next.getTime() <= now.getTime()
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The chosen days as a person says them: "weekdays", "every day", or "Mon, Wed, Fri". */
export function daysLabel(days: readonly number[]): string {
  if (days.length === 7) return 'every day'
  if (days.length === 5 && WEEKDAYS_ONLY.every((day) => days.includes(day))) return 'weekdays'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'weekends'
  // Monday first, as a week reads; Sunday last.
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => DAY_NAMES[day] ?? '').join(', ')
}

/** How the schedule reads on a card. */
export function scheduleLabel(schedule: RoutineSchedule | undefined): string {
  if (schedule === undefined) return 'when you press Run'
  if (schedule.kind === 'every') return schedule.hours === 1 ? 'every hour' : `every ${String(schedule.hours)} hours`
  if (schedule.kind === 'weekly') return `${daysLabel(schedule.days)} at ${schedule.at}`
  if (schedule.kind === 'once') {
    const moment = onceMoment(schedule.on)
    if (moment === undefined) return 'once'
    return `once, ${DAY_NAMES[moment.getDay()] ?? ''} ${MONTH_NAMES[moment.getMonth()] ?? ''} ${String(moment.getDate())} at ${schedule.on.slice(11)}`
  }
  return `daily at ${schedule.at}`
}
