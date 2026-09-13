import { describe, expect, it } from 'vitest'

import { cursorIgnoreHit, cursorIgnoreSentence } from './cursorIgnore.js'

/*
 * The three real files, as they actually were on this machine when each
 * incident happened. Fixtures invented for this would prove nothing: every
 * one of these bugs turned on a shape somebody had written for a good reason.
 */
const AS_IT_WAS = [
  '# stop Cursor snapshot-indexing multi-GB agent transcripts.',
  '.claude/',
  '.codex/',
  '.gemini/',
  '.cursor/projects/',
  'AppData/',
  'node_modules/',
  '**/node_modules/'
].join('\n')

const AS_FIXED = [
  '# stop Cursor snapshot-indexing multi-GB agent transcripts.',
  '.claude/*',
  '!.claude/.locust/',
  '.codex/*',
  '!.codex/worktrees/',
  '.gemini/',
  '.cursor/projects/',
  'AppData/',
  'node_modules/',
  '**/node_modules/'
].join('\n')

describe('which rule hides a path from Cursor', () => {
  it('finds the bare directory rule, the shape all three incidents began as', () => {
    expect(cursorIgnoreHit('C:/Users/<home>/.claude/.locust/attachments/image-2.png', AS_IT_WAS))
      .toMatchObject({ directory: '.claude' })
    expect(cursorIgnoreHit('C:/Users/<home>/.codex/worktrees/e6a8/locust-astra', AS_IT_WAS))
      .toMatchObject({ directory: '.codex' })
    expect(cursorIgnoreHit('C:/Users/<home>/AppData/Local/Temp/locust-x/file.ts', AS_IT_WAS))
      .toMatchObject({ directory: 'AppData' })
  })

  it('reads the `dir/*` shape, which is what every fix turns into', () => {
    /*
     * THE blind spot in the harness matcher this replaces: it only read rules
     * ending in `/`, so the moment an incident was fixed -- and the fix must
     * be `dir/*`, because gitignore cannot negate inside an excluded
     * directory -- it stopped seeing the rule at all.
     */
    expect(cursorIgnoreHit('C:/Users/<home>/.claude/projects/x/big.jsonl', AS_FIXED))
      .toMatchObject({ directory: '.claude' })
  })

  it('honours the re-inclusion, or it would cry wolf about the fix itself', () => {
    expect(cursorIgnoreHit('C:/Users/<home>/.claude/.locust/attachments/image-2.png', AS_FIXED)).toBeUndefined()
    expect(cursorIgnoreHit('C:/Users/<home>/.codex/worktrees/e6a8/locust-astra', AS_FIXED)).toBeUndefined()
  })

  it('matches a multi-part rule only where the parts run together', () => {
    expect(cursorIgnoreHit('C:/Users/<home>/.cursor/projects/abc/log', AS_IT_WAS))
      .toMatchObject({ directory: '.cursor/projects' })
    // `.cursor` alone is not the rule, and neither is `projects` alone.
    expect(cursorIgnoreHit('C:/Users/<home>/.cursor/extensions', AS_IT_WAS)).toBeUndefined()
    expect(cursorIgnoreHit('C:/work/projects/app', AS_IT_WAS)).toBeUndefined()
  })

  it('stays quiet about a path nothing names, and about comments', () => {
    expect(cursorIgnoreHit('C:/Users/<home>/Documents/Codex/app/src/index.ts', AS_IT_WAS)).toBeUndefined()
    expect(cursorIgnoreHit('C:/Users/<home>/stop/x', '# stop Cursor snapshot-indexing')).toBeUndefined()
  })

  it('reads `**/name/` as the directory anywhere on the path', () => {
    expect(cursorIgnoreHit('C:/app/packages/ui/node_modules/react/index.js', AS_IT_WAS))
      .toMatchObject({ directory: 'node_modules' })
  })

  it('splits a REAL Windows path, which every fixture here used to dodge', () => {
    /*
     * The test that would have caught it. The separator was a character class
     * a shell had halved, so it matched forward slash only -- and every
     * fixture above is written with forward slashes, so seven tests passed
     * over a matcher that could not read a single path this app actually
     * handles. The paths below are built from the escape so nothing can halve
     * them on the way to disk either.
     */
    const SEP = String.fromCharCode(92)
    const windowsPath = ['C:', 'Users', '<home>', '.claude', '.locust', 'attachments', 'a.png'].join(SEP)
    expect(cursorIgnoreHit(windowsPath, AS_IT_WAS)).toMatchObject({ directory: '.claude' })
    expect(cursorIgnoreHit(windowsPath, AS_FIXED)).toBeUndefined()
    const mixed = 'C:' + SEP + 'Users/<home>' + SEP + 'AppData/Local/Temp/x'
    expect(cursorIgnoreHit(mixed, AS_IT_WAS)).toMatchObject({ directory: 'AppData' })
  })

  it('does not tell you to change a rule into itself', () => {
    /*
     * 0.87.0 shipped advice that read "Change that rule to \".claude/*\"" when
     * the rule ALREADY was `.claude/*`. A message that tells a person to make
     * a change they have made is how they stop believing the rest of it.
     *
     * The two cases need different advice: a bare `dir/` cannot be negated at
     * all, so the rule itself must change; a `dir/*` already can be, so what
     * is missing is the line that lets this folder back in.
     */
    const narrowed = cursorIgnoreHit('C:/Users/<home>/.claude/projects/x', AS_FIXED)
    expect(narrowed).toMatchObject({ alreadyNarrowed: true })
    const advice = cursorIgnoreSentence(narrowed!, 'C:/Users/<home>/.cursorignore')
    expect(advice).not.toContain('Change that rule')
    expect(advice).toContain('Add "!.claude/')

    const bare = cursorIgnoreHit('C:/Users/<home>/.claude/projects/x', AS_IT_WAS)
    expect(bare).toMatchObject({ alreadyNarrowed: false })
    expect(cursorIgnoreSentence(bare!, 'C:/x/.cursorignore')).toContain('Change that rule to ".claude/*"')
  })

  it('says what to do, naming the rule and the file', () => {
    const hit = cursorIgnoreHit('C:/Users/<home>/.claude/.locust/attachments/a.png', AS_IT_WAS)
    const said = cursorIgnoreSentence(hit!, 'C:/Users/<home>/.cursorignore')
    // The rule and where it lives, because "Cursor cannot read this folder"
    // on its own is the same dead end the runtime already gives.
    expect(said).toContain('.cursorignore')
    expect(said).toContain('".claude/"')
    expect(said).toContain('".claude/*"')
    expect(said).toContain('permission denied')
  })
})
