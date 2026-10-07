import { describe, expect, it } from 'vitest'

import { activityEntries, liveActionLine, railToolName, relativePath, stepsLine } from './missionView.js'

/**
 * A SKILL ROW NAMES ITS SKILL (0.679).
 *
 * Claude Code reports a skill as the tool `Skill` with `{"skill": ...}`, and
 * Locust hands a folder's skills over as the plugin `project`, so the target
 * reads `project:review`. The row says what happened in words -- "Used the
 * review skill" -- without the prefix Locust added; a plugin of the person's
 * own keeps its name, since that says where the skill came from.
 */
describe('a skill row names its skill', () => {
  it('reads as the skill used, without the prefix Locust added', () => {
    const [entry] = activityEntries([{ kind: 'tool', name: 'project:review', tool: 'Skill', settled: true }])
    expect(entry).toMatchObject({ kind: 'tool', name: 'Used the review skill' })
    const [mine] = activityEntries([{ kind: 'tool', name: 'personal:shipcheck', tool: 'Skill', settled: true }])
    expect(mine).toMatchObject({ name: 'Used the shipcheck skill' })
    const [plugin] = activityEntries([{ kind: 'tool', name: 'small-business:ad-manager', tool: 'Skill', settled: true }])
    expect(plugin).toMatchObject({ name: 'Used the small-business:ad-manager skill' })
  })

  it('one with no name still reads as a skill, never as the tool id', () => {
    const [entry] = activityEntries([{ kind: 'tool', name: 'Skill', tool: 'Skill', settled: true }])
    expect(entry).toMatchObject({ name: 'Used a skill' })
  })

  it("the steps' line says which skill, and its short form says a skill, never a tool", () => {
    const copy = 'C:/Users/me/AppData/Roaming/@teammate/desktop/claude-skills/0f8a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b/project/skills/locust-probe/second-word.md'
    const line = stepsLine([
      { kind: 'tool', name: 'project:locust-probe', tool: 'Skill', settled: true },
      { kind: 'tool', name: copy, tool: 'Read', settled: true }
    ], true, 'C:/work/pebble')
    expect(line.title).toMatch(/^Used the locust-probe skill, read .*second-word\.md/)
    expect(line.shorter.join(' | ')).not.toMatch(/a tool/)
    expect(line.shorter.some((form) => /^Used a skill/.test(form))).toBe(true)
  })

  it("a skill's own file reads as the file it is a copy of, not the run's copy", () => {
    const root = 'C:/Users/me/AppData/Roaming/@teammate/desktop/claude-skills/0f8a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b'
    expect(relativePath(`${root}/project/skills/locust-probe/second-word.md`, 'C:/work/pebble')).toBe('.claude/skills/locust-probe/second-word.md')
    // Windows separators, as Claude Code reports them.
    const windows = `${root}/personal/skills/shipcheck/SKILL.md`.split('/').join(String.fromCharCode(92))
    expect(relativePath(windows, 'C:/work/pebble')).toBe('~/.claude/skills/shipcheck/SKILL.md')
  })

  it('the live line and the rail say the same', () => {
    expect(liveActionLine({ kind: 'tool', name: 'project:review', tool: 'Skill', settled: false })).toBe('Using the review skill')
    expect(railToolName({ name: 'Skill', toolKind: 'tool_use', command: 'project:review' })).toBe('Used the review skill')
  })
})
