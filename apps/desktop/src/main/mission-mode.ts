import type { MissionMode } from '../shared/ipc.js'

/**
 * The mode a request from the window asks for, read the one way every path
 * reads it: an explicit mode Locust knows travels as itself, and anything
 * else -- missing, malformed -- is read-only `ask`, so a bad request never
 * widens what a run may touch. Auto is still refused further in when the
 * workspace has it switched off, on the path every run takes.
 *
 * M26 (the code review): start read it this way, and handoff and resume
 * accepted only `accept-edits`, turning Auto, Approve-each and Plan into
 * read-only Ask -- a handed-off Auto run could not write, a resumed plan lost
 * its plan, and the handoff saved Ask as the teammate's route.
 */
export function parsedMissionMode(value: unknown): MissionMode {
  return value === 'accept-edits' || value === 'approve-each' || value === 'auto' || value === 'plan' ? value : 'ask'
}
