import { createContext } from 'react'

import type { MissionApprovalRequest } from '../../shared/ipc.js'

/**
 * What an approval card can save as a rule (0.521, shared/approval-rules.ts):
 * the sentence it would save, and saving it. Provided by App, read by every
 * card wherever it is drawn -- a conversation or a comparison's column --
 * without threading it through each. Undefined for a card no rule can hold
 * exactly; the card then offers what it always did.
 */
export interface CardRule {
  /** The rule as a person reads it: "Wren may run "git status" in project without asking." */
  readonly allowSentence: string
  readonly denySentence: string
  /** Answer the card and save the rule; resolves to what went wrong, or undefined. */
  readonly save: (effect: 'allow' | 'deny', reason?: string) => Promise<string | undefined>
}

export const ApprovalRuleContext = createContext<(request: MissionApprovalRequest) => CardRule | undefined>(() => undefined)
