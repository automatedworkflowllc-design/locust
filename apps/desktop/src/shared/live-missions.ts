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
 * post, each asked to count to 250 one number per line.
 *
 * THE QUEUE CLAIM THIS COMMENT USED TO MAKE WAS WRONG. It said counting was
 * "steady high-rate output, which is what would overflow a bounded queue if
 * anything would". Astra measured the receipts (2026-09-09): a whole
 * 500-number count arrives as THREE provider records, one of them the entire
 * text. It never approaches the 2,048-record per-mission queue. So "the queue
 * never overflowed" was true and empty -- the probe never put a record stream
 * near it, and the cap's original justification remains untested rather than
 * disproved. The cap and the queue-saturation question are separate, and only
 * the first of them has been measured.
 *
 *   N=1   19s   peak 1.7 GB   250 of 250
 *   N=4   22s   peak 3.1 GB   250 of 250, four times over
 *   N=8   34s   peak 4.2 GB   250 of 250, eight times over; ledger
 *                             verified; no output-limit failure
 *
 * Eight times the work for 1.8x the wall clock, about 370 MB per added
 * mission, and 4.2 GB of the 24 GB on the machine it was measured on (12
 * logical cores).
 *
 * A second correction from the same measurement: ROOM SIZE IS NOT
 * SIMULTANEOUS PROCESS COUNT. Room dispatch awaits each start in turn, so a
 * read-only room of eight peaked at six overlapping process lifetimes, and
 * rooms of ten and twelve peaked at seven. The numbers above are honest
 * about wall clock and memory for a room of that size; they are not eight
 * processes running at one instant, and nothing here should be read as a
 * per-simultaneous-agent cost.
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
 * Astra then took it further on the same machine, with both limits raised to
 * 16 locally (`docs/FINDING-live-mission-frontier-2026-09-09.md`): eight-,
 * twelve- and sixteen-way WRITE batches all produced exact files and exact
 * replies, with zero ledger integrity issues, zero output-limit failures and
 * zero dropped records. No data-loss frontier was found through sixteen.
 *
 * Eight stays anyway, and the reason is the screen rather than the machine.
 * At sixteen the renderer's 250ms heartbeat stalled for nearly TWELVE
 * SECONDS and event delivery lagged by up to eight. That is a liveness
 * warning, not lost work -- and it is the kind of thing a person feels as
 * the app being broken.
 *
 * What is NOT measured, and would need to be before this goes higher: a
 * machine with less than 24 GB, runtimes heavier than OpenCode's free model,
 * whether a genuinely dense record stream saturates the queue, and whether
 * any of it repeats.
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
