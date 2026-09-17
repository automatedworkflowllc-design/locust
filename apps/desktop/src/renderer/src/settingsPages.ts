/**
 * Settings as PAGES, not one scroll.
 *
 * Colin asked for this twice. The first time (2026-09-14) the answer was to
 * group thirteen subjects into five named areas, still in one column, and he
 * said again on 2026-09-17: "our settings is a literal disaster". It was: the
 * areas were right and you still had to scroll past four of them to reach the
 * fifth, and nothing told you the fifth existed.
 *
 * So the areas become pages with a list beside them, which is the shape
 * Claude Code uses and the one he pointed at. Nothing about the settings
 * themselves changes -- same sections, same order, same words behind `More`.
 * What changes is that you can see the whole map at once and land on any of
 * it in one press.
 *
 * The headings are listed here so the search can find a setting by its own
 * name rather than only by the page it lives on. `settings-pages-are-real`
 * holds this list to the headings the file actually renders, because an index
 * that drifts is worse than no index: it would quietly stop finding things.
 */
export type SettingsPageId = 'workspace' | 'runtimes' | 'teammates' | 'appearance' | 'app'

export const SETTINGS_PAGES: readonly {
  readonly id: SettingsPageId
  readonly label: string
  readonly headings: readonly string[]
}[] = [
  { id: 'workspace', label: 'Your workspace', headings: ['Project folder', 'Teammates'] },
  { id: 'runtimes', label: 'Runtimes', headings: ['Runtimes & accounts', 'Connectors', 'When a route hits its limit'] },
  {
    id: 'teammates',
    label: 'How teammates work',
    headings: ['Swarm', 'Auto mode', 'Plans', 'What your team remembers']
  },
  { id: 'appearance', label: 'Appearance', headings: ['Sidebar', 'The boot screen'] },
  { id: 'app', label: 'This app', headings: ['Updates', 'Privacy & local data', 'Trash', 'Report a problem'] }
]

/** Case- and punctuation-insensitive enough that "auto" finds "Auto mode". */
export function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}
