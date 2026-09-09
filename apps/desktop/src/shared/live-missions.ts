/**
 * How many missions may run at once.
 *
 * A resource bound, not a product rule: each live mission is a provider
 * process holding a bounded record queue and a ledger writer, and four of
 * them is already more than one person can follow.
 *
 * It lives in shared/ because the screen has to be able to say it. A room
 * post starts one mission per member, so a room with more members than this
 * has members who simply never run -- and until 2026-09-09 nothing on the
 * way in mentioned that. A six-member room offered all six, took all six,
 * started four, and then said "Everyone in Standup has answered." The host
 * knew the number the whole time; the screen did not.
 */
export const MAX_LIVE_MISSIONS = 4
