import { useRef } from 'react'
import type { ReactElement } from 'react'

import type { RoutineTemplateInfo } from '../../../shared/ipc.js'
import { useModal } from '../useModal.js'

/**
 * START FROM A TEMPLATE (0.615; the PRD's R16).
 *
 * The starter routines Locust ships, as a list a person picks from. Choosing
 * one opens the import preview a routine file gets -- its steps, what it will
 * ask, and who to give it to -- because a template IS a routine file
 * (main/routine-templates.ts), so nothing is added until that dialog's Add.
 *
 * Shown in two places: in the empty Routines screen, where its absence is
 * felt, and from the add row under a list that already has routines.
 */

const count = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${String(n)} ${many}`)

/** "1 step · no questions", "4 steps · 1 question": what a template is before it is opened. */
export function templateMeta(template: RoutineTemplateInfo): string {
  const asks = template.asks.length === 0 ? 'no questions' : count(template.asks.length, 'question', 'questions')
  return `${count(template.steps, 'step', 'steps')} · ${asks}`
}

/** The add row's line: the first few by name, so the row says what is in it. */
export function templatesLine(templates: readonly RoutineTemplateInfo[]): string {
  const named = templates.slice(0, 3).map((template) => template.name)
  const more = templates.length - named.length
  return more > 0 ? `${named.join(', ')} and ${String(more)} more` : named.join(', ')
}

export function RoutineTemplateList({ templates, onUse }: {
  readonly templates: readonly RoutineTemplateInfo[]
  readonly onUse: (id: string) => void
}): ReactElement {
  return (
    <div className="lc-templates">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          className="lc-templates__row"
          onClick={() => onUse(template.id)}
          {...(template.asks.length === 0 ? {} : { title: `It asks: ${template.asks.join(' · ')}` })}
        >
          <span className="lc-templates__name">{template.name}</span>
          <span className="lc-templates__meta lc-mono">{templateMeta(template)}</span>
          <span className="lc-templates__what">{template.summary}</span>
        </button>
      ))}
    </div>
  )
}

export function RoutineTemplateDialog({ templates, onUse, onCancel }: {
  readonly templates: readonly RoutineTemplateInfo[]
  readonly onUse: (id: string) => void
  readonly onCancel: () => void
}): ReactElement {
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onCancel)
  return (
    <div className="lc-scrim">
      <div ref={box} className="lc-dialog lc-templatedialog" role="dialog" aria-modal="true" aria-label="Start from a template">
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">Start from a template</span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <div className="lc-dialog__body">
          <p className="lc-dialog__note">Each opens as a preview. Nothing is added until you give it to a teammate.</p>
          <RoutineTemplateList templates={templates} onUse={onUse} />
        </div>
      </div>
    </div>
  )
}
