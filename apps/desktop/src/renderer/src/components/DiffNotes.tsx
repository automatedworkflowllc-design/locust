import { createContext, useContext } from 'react'

import type { DiffNote } from '../diffNotes.js'

/**
 * Where a note on a diff can be written (diffNotes.ts, 0.376).
 *
 * Provided only around the conversation on screen, whose chat box is where
 * the notes go -- so a diff in a room's answer or on an approval card offers
 * no "+": there is nowhere there for a note to be sent from.
 */
export interface DiffNotesPlace {
  readonly notes: readonly DiffNote[]
  readonly add: (note: DiffNote) => void
  readonly remove: (key: string) => void
  /** Who the notes will go to, named in the editor. */
  readonly who: string
}

export const DiffNotesContext = createContext<DiffNotesPlace | undefined>(undefined)

export function useDiffNotes(): DiffNotesPlace | undefined {
  return useContext(DiffNotesContext)
}
