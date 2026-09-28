import { createContext } from 'react'

/**
 * PAGES ALREADY SHOWN ABOVE (0.450).
 *
 * A comparison that builds shows each column's page at the top of its cell,
 * so the pages line up side by side whatever each model did first (the Build
 * and compare promo frames, 2026-09-28: one column's page sat under its plan
 * and four commands, level with the other column's footer). The same page
 * must not open a second time lower down, in its file row: the paths here are
 * left folded there.
 */
export const PinnedPagesContext = createContext<ReadonlySet<string>>(new Set())

/**
 * Inside a comparison column (0.453). Its foot says what the column changed
 * -- measured in its copy, exactly what Keep would bring in -- so a fold's
 * running tally of every edit on the way ("+9 -5" beside a foot's "+3 -1",
 * the free cents comparison, 2026-09-28) reads as a contradiction there.
 */
export const InComparisonCell = createContext(false)
