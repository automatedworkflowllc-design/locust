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
