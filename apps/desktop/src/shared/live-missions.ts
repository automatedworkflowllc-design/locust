/**
 * How many missions may run at once.
 *
 * **Eight, measured on 2026-09-09.** It was four from P6b (32dd88b, 1 Sep)
 * until then, called "a resource bound" in that commit and "already more
 * than one person can follow" in the code. Neither claim had a number behind
 * it, and the cost it named -- a provider process holding a bounded record
 * queue whose filling ends a run as an output-limit failure -- had never
 * been put under load.
 *
 * `_tools/drive-cap-probe.mjs` put it under load. Teammates in one room, one
 * post, each asked to count to 250 one number per line: steady high-rate
 * output from every run at once, which is what would overflow a bounded
 * queue if anything would.
 *
 *   N=1   19s   peak 1.7 GB   250 of 250
 *   N=4   22s   peak 3.1 GB   250 of 250, four times over
 *   N=8   34s   peak 4.2 GB   250 of 250, eight times over; ledger
 *                             verified; no output-limit failure
 *
 * Eight times the work for 1.8x the wall clock, about 370 MB per added
 * mission, and 4.2 GB of the 24 GB on the machine it was measured on (12
 * logical cores). The queue never overflowed. Nothing the old number was
 * protecting against happened.
 *
 * The first attempt at this measurement was WRONG and its numbers are gone.
 * `scratchRepository` writes a LOCUST.md reading "Keep answers to one
 * paragraph", Locust carries it to every teammate, and eight agents spent
 * their run arguing with it -- "Your 1-to-250 count conflicts with the
 * one-paragraph rule" -- rather than producing the output being measured.
 * The fixture now takes a brief, and the probe passes one that does not
 * fight its own prompt.
 *
 * Eight and not more, for two reasons. `MAX_ROOM_TEAMMATES` is 8, so eight
 * makes a full room answerable -- which removes the whole class of defect
 * found the same day, where a room silently started four of its six members
 * and then said everyone had answered; `room-and-mission-caps-agree.test.ts`
 * holds the two numbers together so that stays true. And past eight is
 * simply unmeasured: N=12 could not be run, because a room cannot be built
 * that big.
 *
 * What is NOT measured, and would need to be before this goes higher: a
 * machine with less than 24 GB (the eight runs cost roughly 440 MB each on
 * top of the app, so 8 GB is a different question), runtimes heavier than
 * OpenCode's free model, and write mode rather than read-only.
 *
 * It lives in shared/ because the screen has to be able to say it.
 */
export const MAX_LIVE_MISSIONS = 8

/**
 * How many teammates a room may hold.
 *
 * It lives here, beside the mission cap, because the two have to agree: a
 * room bigger than what can run has members who never start, which is the
 * defect of 2026-09-09 in one sentence. `room-and-mission-caps-agree` holds
 * them together.
 *
 * The screen needs it too. Ticking a ninth teammate used to be allowed and
 * then refused by the store on Create room -- offered and then refused, the
 * pattern this app tries not to have anywhere.
 */
export const MAX_ROOM_TEAMMATES = 8
