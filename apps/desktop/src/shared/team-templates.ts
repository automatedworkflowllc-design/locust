import type { BotShape, BotFace } from './avatar.js'
import type { TeammateHue, TeammateRole } from './ipc.js'

/**
 * A TEAM IN ONE CLICK.
 *
 * Paperclip's second idea worth taking (2026-09-26): a person who opens
 * Locust for the first time meets an empty Home and one button, and has to
 * invent a teammate -- a name, a role, a face -- before anything happens.
 * Locust is for "quite literally ANY ai user" (Colin): someone writing code,
 * someone watching their money, someone writing or designing. So Home offers
 * a team for each, ready to talk to; every one of them can be renamed,
 * re-faced, given another model or removed like any teammate.
 *
 * No model is chosen here. A template cannot know which of the person's
 * tools are signed in, so each teammate runs on the model the person picks,
 * exactly as a teammate made by hand does before its first run.
 */
export interface TemplateTeammate {
  readonly name: string
  readonly role: TeammateRole
  /** A Custom teammate's own words for what they do. */
  readonly roleTitle?: string
  readonly hue: TeammateHue
  readonly bot: { readonly shape: BotShape; readonly face: BotFace }
}

export interface TeamTemplate {
  readonly templateId: 'software' | 'money' | 'writing'
  readonly title: string
  /** One line: who is on it, said as what they do. */
  readonly line: string
  readonly teammates: readonly TemplateTeammate[]
}

export const TEAM_TEMPLATES: readonly TeamTemplate[] = [
  {
    templateId: 'software',
    title: 'Build software',
    line: 'A coder, a reviewer who tests, and a researcher.',
    teammates: [
      { name: 'Wren', role: 'Code & Migrations', hue: 'lime', bot: { shape: 'droid', face: 'eyes' } },
      { name: 'Juno', role: 'Docs & QA', hue: 'violet', bot: { shape: 'cat', face: 'mouth' } },
      { name: 'Atlas', role: 'Research & Briefs', hue: 'blue', bot: { shape: 'hexagon', face: 'eyes' } }
    ]
  },
  {
    templateId: 'money',
    title: 'Research & money',
    line: 'An analyst, a keeper of the numbers, and a planner.',
    teammates: [
      { name: 'Sable', role: 'Research & Briefs', hue: 'teal', bot: { shape: 'alien', face: 'eyes' } },
      { name: 'Penny', role: 'Data & Reporting', hue: 'butter', bot: { shape: 'pill', face: 'mouth' } },
      { name: 'Rook', role: 'Chief of Staff', hue: 'slate', bot: { shape: 'mech', face: 'eyes' } }
    ]
  },
  {
    templateId: 'writing',
    title: 'Write & design',
    line: 'A writer, a designer, and an editor.',
    teammates: [
      { name: 'Quill', role: 'Custom', roleTitle: 'Writer', hue: 'rose', bot: { shape: 'flower', face: 'mouth' } },
      { name: 'Iris', role: 'Custom', roleTitle: 'Designer', hue: 'clay', bot: { shape: 'cloud', face: 'eyes' } },
      { name: 'Moss', role: 'Docs & QA', hue: 'pearl', bot: { shape: 'pebble', face: 'mouth' } }
    ]
  }
]
