import { homedir } from 'node:os'
import { join } from 'node:path'

import type { TeammateRoute } from '../shared/ipc.js'

/**
 * PLACES (0.501): a standing corner of Locust for one kind of work that is
 * not a project -- today, a person's own money.
 *
 * Asked for by a tester who "really feels connected" to Codex's Finances and
 * wanted the same inside Locust (Colin, 2026-09-30: "mirror it for people
 * that tick it on in settings and then it could appear in sidebar"). Checked
 * first, on the release machine: Codex CLI, run as Locust runs it, offers the
 * Claude finance skills but not OpenAI's `finances` connector -- that one's
 * tools appear only once accounts are linked, on OpenAI's side. So the place
 * does not depend on it: it is a folder of the person's own, outside every
 * project, where statements are dropped (CSV or PDF exports), and a teammate
 * on Codex that only ever reads (Ask). Where the person HAS linked accounts
 * in Codex, the same teammate can use them. Locust links nothing, stores no
 * account detail, and can move no money.
 */
// LOCUST_PLACES_ROOT is a drive's own folder: a test statement never lands in the person's real place.
export const PLACES_ROOT = process.env.LOCUST_PLACES_ROOT ?? join(homedir(), '.locust', 'places')
export const FINANCES_FOLDER = join(PLACES_ROOT, 'finances')

/** Said in the folder itself, for a person who opens it from their file manager. */
export const FINANCES_README = [
  '# Finances',
  '',
  'This folder is your Finances place in Locust.',
  '',
  'Drop statements here -- CSV or PDF exports from your bank or card -- and ask',
  'the Finances teammate about them: where the money went, what repeats every',
  'month, what changed since last month.',
  '',
  'The teammate only reads. It cannot change these files, and nothing in Locust',
  'can move money. If you linked accounts in Codex\'s own Finances, it can read',
  'those too; Locust never asks for bank details.',
  ''
].join('\n')

export const FINANCES_TEAMMATE = {
  name: 'Finances',
  hue: 'teal',
  // Its own words under its name, as a Custom teammate has, not a stock role's.
  role: 'Custom',
  roleTitle: 'Reads the statements you put in its folder',
  starters: [
    'Where did my money go this month? Group it by category and show the biggest ones first.',
    'What am I paying for every month? List the subscriptions and repeating charges.',
    'How does this month compare with last month? Say what changed the most.'
  ]
} as const

export const FINANCES_ROUTE: TeammateRoute = { runtime: 'codex', model: 'account-default', mode: 'ask' }
