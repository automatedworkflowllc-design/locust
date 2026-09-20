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
 *
 * `alsoKnownAs` is the OTHER half, and it exists because an index of headings
 * only finds the words WE chose. Grok's pass 9 typed four words a person who
 * had just used the app would type -- memory, worktree, node, ledger -- and
 * every one was answered "Nothing matches. The pages are still here". All
 * four settings exist. Memory is under "What your team remembers"; worktrees
 * are under "Project folder"; the ledger is a definition on "Privacy & local
 * data". Being told a thing does not exist is worse than having to scroll for
 * it, because a person stops looking.
 *
 * Each word is filed UNDER THE HEADING IT LEADS TO, so a search for a word
 * that is nowhere on the screen can still answer with the place it lives:
 * type "memory", get "What your team remembers". A flat list of page-level
 * words would find the page and leave the person to hunt it.
 *
 * These are deliberately not headings. Renaming "What your team remembers" to
 * "Memory" would make the screen read like a search index, and the heading is
 * the better sentence. The two lists are kept apart so the drift guard goes
 * on meaning exactly what it means.
 */
export type SettingsPageId = 'workspace' | 'runtimes' | 'teammates' | 'appearance' | 'app'

export interface SettingsPage {
  readonly id: SettingsPageId
  readonly label: string
  readonly headings: readonly string[]
  /**
   * Words a person types that are not the name of anything on the page,
   * keyed by the heading each one leads to. Every key must be one of
   * `headings` -- `settings-search-knows-the-words` holds that.
   */
  readonly alsoKnownAs?: Readonly<Record<string, readonly string[]>>
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'workspace',
    label: 'Your workspace',
    headings: ['Project folder', 'Teammates'],
    alsoKnownAs: {
      // Own branches are set here, under the folder they branch from.
      'Project folder': ['worktree', 'worktrees', 'branch', 'branches', 'folder', 'path', 'directory', 'project', 'repo'],
      Teammates: ['role', 'roles', 'name', 'rename']
    }
  },
  {
    id: 'runtimes',
    label: 'Runtimes',
    headings: ['Runtimes & accounts', 'Connectors', 'When a route hits its limit'],
    alsoKnownAs: {
      // "node" and "npm" are what a person types after the first screen has
      // just talked to them about Node. This is the page about the CLIs that
      // are installed with them.
      'Runtimes & accounts': ['node', 'node.js', 'npm', 'install', 'cli', 'model', 'models', 'sign in', 'account', 'api key'],
      Connectors: ['mcp', 'tools', 'server'],
      'When a route hits its limit': ['limit', 'quota', 'rate limit', 'usage', 'fallback']
    }
  },
  {
    id: 'teammates',
    label: 'How teammates work',
    headings: ['Swarm', 'Auto mode', 'Plans', 'What your team remembers'],
    alsoKnownAs: {
      Swarm: ['parallel', 'at once', 'concurrent'],
      'Auto mode': ['permission', 'approve', 'ask first', 'sandbox'],
      Plans: ['plan', 'steps'],
      // The one Grok said to do first.
      'What your team remembers': ['memory', 'remember', 'remembers', 'notes', 'recall']
    }
  },
  {
    id: 'appearance',
    label: 'Appearance',
    headings: ['Sidebar', 'Reply text size', 'The boot screen'],
    alsoKnownAs: {
      // 'font' moved to Reply text size, which is the only setting in this
      // app that changes one. The sidebar has never had a font control.
      Sidebar: ['theme', 'dark', 'light', 'colour', 'color', 'width'],
      // The words a person reaches for when a reply is too big or too small:
      // Colin's own were 'text size', and nobody searches for 'prose'.
      'Reply text size': ['text', 'text size', 'font', 'font size', 'bigger', 'smaller', 'type', 'reading'],
      'The boot screen': ['splash', 'startup', 'launch']
    }
  },
  {
    id: 'app',
    label: 'This app',
    headings: ['Updates', 'Privacy & local data', 'Trash', 'Report a problem'],
    alsoKnownAs: {
      Updates: ['version', 'changelog', 'what changed', 'upgrade'],
      // "ledger" is a word the app itself says to people, in the sentence
      // telling them where the record of a run lives -- and it was the
      // fourth miss.
      'Privacy & local data': ['ledger', 'log', 'logs', 'telemetry', 'privacy', 'where is my data'],
      // "recycle bin" is here because that is what Trash is called on the
      // platform this ships to.
      Trash: ['deleted', 'delete', 'restore', 'undo', 'recycle', 'recycle bin', 'bin'],
      'Report a problem': ['bug', 'feedback', 'support', 'crash']
    }
  }
]

/** Case- and punctuation-insensitive enough that "auto" finds "Auto mode". */
export function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}

/**
 * The headings on this page that answer what was typed -- whether the person
 * used the heading's own words or one of the words it is also known by.
 */
export function matchedHeadings(page: SettingsPage, query: string): readonly string[] {
  return page.headings.filter(
    (heading) =>
      matches(heading, query) ||
      (page.alsoKnownAs?.[heading] ?? []).some((word) => matches(word, query))
  )
}

/** Whether this page answers what was typed at all. */
export function pageMatches(page: SettingsPage, query: string): boolean {
  return matches(page.label, query) || matchedHeadings(page, query).length > 0
}
