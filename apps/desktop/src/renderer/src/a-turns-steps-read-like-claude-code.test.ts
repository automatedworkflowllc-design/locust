import { describe, expect, it } from 'vitest'

import { commandLooksAt, shortName, stepsLine } from './missionView.js'
import type { ActivityDetail } from './missionView.js'

/**
 * A TURN'S STEPS READ LIKE CLAUDE CODE'S (0.491). Colin, 2026-09-30, with a
 * frame of Claude Code's app beside Locust's: every command "rolled into the
 * bar". Claude Code says each group of steps in one line -- "Read 2 files,
 * ran a command", "Created ce3.py", in red "Failed to add per-column effort
 * chip and CSS" -- and a lone step is named by what the model said it was
 * for. The same line, from each runtime's own shape of step.
 */
const shell = (name: string, over: Partial<ActivityDetail> = {}): ActivityDetail => ({ kind: 'shell', name, tool: 'bash', settled: true, exitCode: 0, ...over })
const tool = (tool: string, name: string, over: Partial<ActivityDetail> = {}): ActivityDetail => ({ kind: 'tool', name, tool, settled: true, ...over })
const line = (details: readonly ActivityDetail[], finished = true): string =>
  stepsLine(details, finished).segments.map((segment) => (segment.tone === 'amber' ? `[${segment.text}]` : segment.text)).join(' · ')

describe('a group of steps, in one line', () => {
  it('names a lone command by what the model said it was for (Claude Code)', () => {
    expect(line([shell('pnpm esbuild x.ts', { title: 'Bundle with pnpm esbuild and run benchmark' })])).toBe('Bundle with pnpm esbuild and run benchmark')
  })

  it('says a lone described command that failed as the thing not done', () => {
    expect(line([shell('python ce3.py', { title: 'Add per-column effort chip and CSS', failed: true, exitCode: 2 })])).toBe('[Failed to add per-column effort chip and CSS]')
  })

  it('counts reads and commands the way Claude Code does', () => {
    expect(line([tool('Read', 'src/a.ts'), tool('Read', 'src/b.ts'), shell('git status')])).toBe('Read 2 files, ran git status')
    expect(line([shell('npm test'), shell('npm run build'), tool('Read', 'Composer.tsx')])).toBe('Ran 2 commands, read Composer.tsx')
  })

  it('reads a command that only looks as looking (Codex and Cursor send no descriptions)', () => {
    expect(line([shell("sed -n '1,80p' src/app.ts"), shell('rg effort src'), shell('ls')])).toBe('Read app.ts, searched for effort, listed a folder')
    expect(commandLooksAt('cd repo && cat README.md')).toBe('read')
    // PowerShell chains with `;`: the file is the first command's.
    expect(line([shell('Get-Content "C:\\tmp\\drive.log" -Tail 80; Write-Output "----TERMINAL----"; Get-Content "C:\\x\\"')])).toBe('Read drive.log')
    expect(commandLooksAt('pnpm test')).toBeUndefined()
  })

  it('names what it made and changed', () => {
    const created: ActivityDetail = {
      kind: 'edit', name: 'ce3.py', tool: 'write', settled: true,
      patch: { text: 'diff --git a/ce3.py b/ce3.py\nnew file mode 100644\n--- /dev/null\n+++ b/ce3.py\n@@ -0,0 +1,2 @@\n+a\n+b\n', truncated: false, added: 2, removed: 0 }
    } as ActivityDetail
    expect(line([created, shell('python ce3.py'), shell('ls -la'), shell('pnpm tsc')])).toBe('Created ce3.py, ran 2 commands, listed a folder')
  })

  it('says how long it thought, first, as Claude Code does', () => {
    expect(line([{ kind: 'reasoning', name: 'thought', settled: true, output: '', durationMs: 12_000 }, shell('npm test')])).toBe('Thought for 12s, ran npm test')
  })

  it('never hides what went wrong: failures, silence, refusals in amber after the words', () => {
    expect(line([shell('npm test', { exitCode: 1, failed: true }), shell('npm run lint')])).toBe('Ran 2 commands · [1 failed]')
    expect(line([shell('npm test', { settled: false })])).toBe('Ran npm test · [1 did not report]')
    expect(line([shell('rm -rf dist', { status: 'refused' }), shell('ls')])).toBe('Listed a folder · [1 refused]')
  })

  it('says searches, waits and a phrase-named read the way a person would', () => {
    expect(line([tool('Grep', 'effort'), tool('Grep', 'slot')])).toBe('Ran 2 searches')
    // Cursor's wait on a command it sent away.
    expect(line([tool('await', 'shell-3'), tool('await', 'shell-3')])).toBe('Waited 2 times')
    // Antigravity names a read by the model's phrase, which is no file name.
    expect(line([tool('list_dir', 'Listing orb user session dirs')])).toBe('Listed a folder')
    expect(line([tool('view_file', '"C:/work/src/app.ts"')])).toBe('Read app.ts')
  })

  it('reads a script, a phrase-named command and a folder searched as a person would', () => {
    // PowerShell here-string: its first line names nothing.
    expect(line([shell("@'\nconsole.log(1)\n'@ | node -")])).toBe('Ran a script')
    // Older Antigravity turns name the command by the model's phrase.
    expect(line([shell('Running probe-picker-contents.mjs --dev')])).toBe('Running probe-picker-contents.mjs --dev')
    // Cursor's grep names the folder it searched.
    expect(line([tool('grep', 'C:\\Users\\me\\project\\src')])).toBe('Searched src')
    // Inline code, and a search that names a folder rather than a pattern.
    expect(line([shell('node --input-type=module -e "import { x } from \'./a.mjs\'; x()"')])).toBe('Ran a node script')
    // Short enough to read: the command itself.
    expect(line([shell('node -e "console.log(6*7)"')])).toBe('Ran node -e "console.log(6*7)"')
    expect(line([shell('rg C:\\Users\\me\\AppData\\Local\\Temp\\run -n')])).toBe('Searched run')
    // Codex's JavaScript tool (Colin's frame, 2026-09-30: "used node_repl.js").
    expect(line([tool('node_repl', 'node_repl.js'), tool('node_repl', 'node_repl.js')])).toBe('Ran JavaScript 2 times')
    expect(line([tool('python_repl', 'x')])).toBe('Ran Python')
    // Finding files by name lists them (Sol, 0.491: "Searched for **/*").
    expect(line([tool('glob', '**/*')])).toBe('Listed every file')
    expect(line([tool('Glob', 'src/**/*.ts')])).toBe('Listed files matching src/**/*.ts')
    // A compound line reads every file its reading commands name (Sol, 0.492).
    expect(line([shell('Get-Content src/a.mjs; Get-Content src/b.mjs, src/c.mjs; Get-Content README.md | Select-Object -First 5')])).toBe('Read 4 files')
    // `rg --files` lists; a bare glob names nothing searched.
    expect(line([shell("rg --files -g '**'")])).toBe('Listed a folder')
    expect(line([shell("rg -n -g '**' validateMonth src")])).toBe('Searched for validateMonth')
    // One command reading two files read two files.
    expect(line([shell('cat README.md LOCUST.md')])).toBe('Read 2 files')
    // A thought alone, with words and no headline (Cursor), says what it was about.
    expect(line([{ kind: 'reasoning', name: 'thought', settled: true, output: 'I will read README.md, then run the two commands.' }])).toBe('Thought: I will read README.md, then run the two commands.')
    // A thought with no length is not said beside the steps.
    expect(line([{ kind: 'reasoning', name: 'thought', settled: true, output: 'x' }, tool('Read', 'a.ts')])).toBe('Read a.ts')
  })

  it('names a connector and a tool it does not know by their own names', () => {
    expect(line([tool('robinhood', 'get_watchlists')])).toBe('Used robinhood')
    expect(line([tool('WebSearch', 'claude code app'), tool('WebFetch', 'https://example.com')])).toBe('Searched the web, fetched a page')
  })
})

/*
 * THE LINE FITS ITS ROW (0.604). Colin's screenshot of 2026-10-04: "created
 * a-full-rule-store-keeps-every-rule.test.ts, edited ap…" -- the row's own
 * end-of-line ellipsis cut the second phrase mid-word while the first name
 * ran whole. A long name is now cut in the middle with its extension kept, and
 * the builder offers the sentence in ever shorter forms for the card to fit
 * to its row: names give way to counts, then the last phrases to "and N more".
 */
describe('a long line fits its row', () => {
  const edited = (name: string): ActivityDetail => ({
    kind: 'edit', name, tool: 'write', settled: true,
    patch: { text: `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-a\n+b\n`, truncated: false, added: 1, removed: 1 }
  } as ActivityDetail)
  const LONG = 'a-full-rule-store-keeps-every-rule.test.ts'

  it('cuts a long file name in the middle and keeps its extension', () => {
    expect(line([edited(LONG)])).toBe('Edited a-full-rule-stor…very-rule.test.ts')
    expect(shortName(LONG)).toHaveLength(34)
    expect(shortName('short.ts')).toBe('short.ts')
    expect(shortName('exactly-thirty-four-characters.ts')).toBe('exactly-thirty-four-characters.ts')
    // No extension: still cut in the middle.
    expect(shortName('a'.repeat(40))).toMatch(/^a+…a+$/)
    expect(shortName('a'.repeat(40))).toHaveLength(34)
  })

  it('offers shorter forms: names give way to counts, then the last phrases to "and N more"', () => {
    const steps = [edited(LONG), shell('cat NOTES.md'), shell('pnpm test'), shell('pnpm tsc'), shell('rg approval src'), shell('ls -la')]
    const built = stepsLine(steps, true)
    expect(built.segments[0]!.text).toBe('Edited a-full-rule-stor…very-rule.test.ts, read NOTES.md, ran 2 commands, searched for approval, listed a folder')
    expect(built.shorter).toEqual([
      'Edited a file, read a file, ran 2 commands, ran a search, listed a folder',
      'Edited a file, read a file, ran 2 commands, ran a search and 1 more',
      'Edited a file, read a file, ran 2 commands and 2 more',
      'Edited a file, read a file and 3 more',
      'Edited a file and 4 more'
    ])
    for (let i = 1; i < built.shorter.length; i += 1) expect(built.shorter[i]!.length).toBeLessThan(built.shorter[i - 1]!.length)
    // The hover says every name whole.
    expect(built.title).toBe(`Edited ${LONG}, read NOTES.md, ran 2 commands, searched for approval, listed a folder`)
    expect(stepsLine([shell('cat NOTES.md')], true).title).toBe('Read NOTES.md')
  })

  it('keeps a thought headline through the shorter forms, and has nothing shorter for a lone failure', () => {
    const thought: ActivityDetail = { kind: 'reasoning', name: 'thinking', tool: 'reasoning', settled: true, durationMs: 4_000, output: 'Checking the store first.' } as ActivityDetail
    const built = stepsLine([thought, edited(LONG), shell('pnpm test')], true)
    expect(built.segments[0]!.text).toBe('Thought for 4s, edited a-full-rule-stor…very-rule.test.ts, ran pnpm test')
    expect(built.shorter[0]).toBe('Thought for 4s, edited a file, ran a command')
    expect(built.shorter.at(-1)).toBe('Thought for 4s and 2 more')
    expect(stepsLine([shell('pnpm test', { title: 'Run the tests', exitCode: 1, failed: true })], true).shorter).toEqual([])
    expect(stepsLine([], true).shorter).toEqual([])
  })
})
