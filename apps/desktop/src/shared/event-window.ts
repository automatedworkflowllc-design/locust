/**
 * HOW MANY OF A TURN'S EVENTS ARE DRAWN (0.627) -- live, and read back from the
 * record, the same number on both sides so a conversation never changes shape
 * between the two (the record keeps every event either way).
 *
 * It was 500 on each side. Colin, 2026-10-05, of a Claude Code / Sonnet 5.5
 * teammate 35 minutes into a run: "complete radio silence and one stacked bar
 * for 40 min?" -- at 17 minutes the same thread had shown two of its messages
 * between three groups of steps. Claude Code sends about eight events a tool
 * call, so past roughly sixty calls the first and the last 499 kept were all
 * steps: the messages and the earlier groups fell out of the window, and the
 * counts went down ("edited 3 files" became "edited 2"). Built from his run's
 * record, the full turn is steps, message, steps, message, steps; built from
 * the 500 kept, one bar of 99 rows.
 *
 * What the window costs, measured on the longest real run at hand (the arena
 * RPG round's Sonnet column at Max, 1 h 26 m, 2,285 events): building the
 * thread takes about 4 ms per 1,000 events -- 9.4 ms for all of it. 3,000
 * holds a run like that whole, at about the cost of a frame.
 */
export const EVENT_WINDOW = 3_000

/** What a turn too long for the window says at its top: its start is kept, not drawn. */
export const TRIMMED_TURN_LINE = 'This turn is long: its first steps are kept in its record, not drawn here.'
