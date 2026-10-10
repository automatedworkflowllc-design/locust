import { createContext } from 'react'

/** A thread's own folder, including a comparison column's separate copy. */
export const ThreadImagesContext = createContext<{
  readonly folder: string | undefined
  readonly onOpenFile: ((path: string) => void) | undefined
  /** Words for the conversation's box, for the person to send (0.733: a status chip changed); absent where there is none. */
  readonly onDraft?: ((text: string) => void) | undefined
}>({ folder: undefined, onOpenFile: undefined })
