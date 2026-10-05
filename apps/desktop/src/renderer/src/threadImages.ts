import { createContext } from 'react'

/** A thread's own folder, including a comparison column's separate copy. */
export const ThreadImagesContext = createContext<{
  readonly folder: string | undefined
  readonly onOpenFile: ((path: string) => void) | undefined
}>({ folder: undefined, onOpenFile: undefined })
