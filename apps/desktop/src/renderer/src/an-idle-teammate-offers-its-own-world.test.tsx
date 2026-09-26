import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { TEAM_TEMPLATES } from '../../shared/team-templates.js'
import { IdleTeammate } from './components/IdleTeammate.js'

/**
 * A TEAMMATE'S FIRST MESSAGES COME FROM ITS OWN WORLD (0.359).
 *
 * A new person pressed Research & money, opened Sable, and was offered
 * "Summarize what this codebase is for, for someone joining tomorrow" --
 * under a line saying she "reads this workspace and explains what it finds"
 * (the first-session drive, packaged 0.358). Six of the nine teammates the
 * Home templates make greeted a person who is not a coder with code.
 */
const idle = (teammate: PublicTeammate): string =>
  renderToStaticMarkup(<IdleTeammate teammate={teammate} canStart onStarter={() => undefined} mode="accept-edits" />)

const made = (mate: (typeof TEAM_TEMPLATES)[number]['teammates'][number]): PublicTeammate => ({
  teammateId: `tm_${mate.name.toLowerCase()}`,
  name: mate.name,
  hue: mate.hue,
  role: mate.role,
  ...(mate.roleTitle === undefined ? {} : { roleTitle: mate.roleTitle }),
  starters: mate.starters,
  avatar: { ...seedAvatar(mate.name), bot: mate.bot },
  createdAt: '2026-09-26T09:00:00.000Z'
})

const CODE_WORDS = /\b(code|codebase|repo|repository|pull request|README)\b/i

describe('an idle teammate', () => {
  it("offers a template teammate's own first messages", () => {
    for (const template of TEAM_TEMPLATES) {
      for (const mate of template.teammates) {
        const html = idle(made(mate))
        for (const starter of mate.starters) expect(html).toContain(starter.replace(/'/g, '&#x27;'))
      }
    }
  })

  it('never offers code to the money or the writing team', () => {
    for (const template of TEAM_TEMPLATES.filter((entry) => entry.templateId !== 'software')) {
      for (const mate of template.teammates) {
        for (const starter of mate.starters) expect(starter).not.toMatch(CODE_WORDS)
        expect(idle(made(mate))).not.toMatch(/codebase|reads this workspace/)
      }
    }
  })

  /*
   * AND NOTHING LOCUST WOULD SHOW AS SOURCE (0.362).
   *
   * Iris's first starter asked for "a one-page website ... as a single HTML
   * file" -- and Locust never runs what a teammate wrote
   * (DECISION-2026-09-20), so the page she made opened as 212 lines of HTML
   * (the Write & design drive, packaged 0.361). A starter for someone who is
   * not a coder asks for something the app can show them.
   */
  it('never asks a non-coder for a page the app would only show as code', () => {
    for (const template of TEAM_TEMPLATES.filter((entry) => entry.templateId !== 'software')) {
      for (const mate of template.teammates) {
        for (const starter of mate.starters) expect(starter).not.toMatch(/\b(HTML|CSS|JavaScript|website|web page)\b/i)
      }
    }
  })

  it('says what the role is for, not that every role reads the workspace', () => {
    const sable = made(TEAM_TEMPLATES[1]!.teammates[0]!)
    expect(idle(sable)).toContain('Research &amp; Briefs · Reading, comparing, summarising.')
    const quill = made(TEAM_TEMPLATES[2]!.teammates[0]!)
    // A Custom teammate's title is what they do.
    expect(idle(quill)).toMatch(/Writer\. Edit is on/)
  })

  it("offers a hand-made teammate its role's, and speaks of code only for the roles that are code", () => {
    const byHand = (role: PublicTeammate['role']): PublicTeammate => ({
      teammateId: 'tm_hand',
      name: 'Hand',
      hue: 'lime',
      role,
      avatar: seedAvatar('hand'),
      createdAt: '2026-09-26T09:00:00.000Z'
    })
    expect(idle(byHand('Code & Migrations'))).toContain('Find the riskiest file in this repo')
    for (const role of ['Research & Briefs', 'Ops & Scheduling', 'Docs & QA', 'Data & Reporting', 'Chief of Staff', 'Custom'] as const) {
      const buttons = idle(byHand(role)).match(/<button[^>]*class="lc-starter"[^>]*>([^<]*)<\/button>/g) ?? []
      expect(buttons).toHaveLength(3)
      for (const button of buttons) expect(button).not.toMatch(CODE_WORDS)
    }
  })
})
