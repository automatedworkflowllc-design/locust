// Token gate for the Locust shell.
//
// Two jobs:
//   1. No component may carry a literal color. Tokens exist so the palette has
//      one definition; a hex in a component is how a second palette starts.
//   2. Every readable text token must clear WCAG AA (4.5:1) against every
//      surface it can sit on. The design spec asks for this explicitly --
//      "verify with a ratio check, not by eye" -- so it is computed here and
//      committed, rather than eyeballed once and forgotten.
//
//   node test/token-gate.mjs              # check
//   node test/token-gate.mjs --self-test  # prove the gate can fail
//
// Scope note: `styles.css` is the pre-redesign stylesheet and is deliberately
// out of scope -- P1 replaces it wholesale. The gate covers `tokens.css` and
// everything under `renderer/src/components/`, which is where the new shell is
// being built, so the new palette cannot drift while the old one is retired.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RENDERER = join(ROOT, 'src', 'renderer', 'src')
const TOKENS = join(RENDERER, 'tokens.css')
const COMPONENTS = join(RENDERER, 'components')
const SHELL = join(RENDERER, 'shell.css')

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g
/** Documentation-only grays from the spec. They must never appear in the app. */
const FORBIDDEN_IN_APP = ['#616666', '#4e5353']

/**
 * `--lc-text-faint` (#7A807F) measures 4.2-4.4:1 and fails AA on copy. It is
 * for NON-TEXT marks only: an icon's stroke via currentColor, a hairline, the
 * `/` separator glyph. So `color:` may not take it, with these exceptions --
 * each one a place where nothing readable is painted, and each one requiring
 * a stated reason before it can be added.
 */
const FAINT_COLOR_EXCEPTIONS = new Map([
  ['.lc-windowcontrols button', 'minimize/maximize/close: SVG strokes through currentColor, labelled by aria-label, no text inside'],
  ['.lc-separator', 'the `/` glyph between route names, which the spec names explicitly'],
  [
    '.lc-workroom__provenance .lc-separator',
    'the `·` between facts on the header strip: punctuation between values, carrying nothing a reader needs to make out'
  ],
  [
    '.lc-railflyout__action > svg',
    'the icon beside a flyout action\'s label ("New conversation with Wren"): the label says what it does, the icon only marks the row'
  ]
])

const FAINT = ['var(--lc-text-faint)', '#7a807f']

/**
 * Every `color:` declaration in a stylesheet, with the selector it sits under.
 * Deliberately simple: rules are flat in these sheets, so the last selector
 * before an opening brace is the one that owns the declaration.
 */
function colorDeclarations(css) {
  const found = []
  let selector = ''
  for (const raw of css.split('\n')) {
    const line = raw.trim()
    if (line.endsWith('{')) selector = line.slice(0, -1).trim()
    else if (/^color:/.test(line)) found.push([selector, line])
  }
  return found
}

function faintTextFindings(label, css) {
  const failures = []
  for (const [selector, declaration] of colorDeclarations(css)) {
    if (!FAINT.some((value) => declaration.toLowerCase().includes(value))) continue
    const allowed = [...FAINT_COLOR_EXCEPTIONS.keys()].some((key) => selector.split(',').some((part) => part.trim() === key))
    if (!allowed) {
      failures.push(
        `${label}: ${selector} sets ${declaration} -- the faint token fails AA on text; use --lc-text-muted, or add the selector to FAINT_COLOR_EXCEPTIONS with the reason nothing readable is painted there`
      )
    }
  }
  return failures
}

function walk(dir) {
  let out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full)
  }
  return out
}

function parseTokens(css) {
  const tokens = new Map()
  for (const match of css.matchAll(/(--lc-[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim())
  }
  return tokens
}

function toRgb(hex) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

function relativeLuminance(hex) {
  const channels = toRgb(hex).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Text tokens that carry readable copy, and the surfaces they sit on.
 *
 * `--lc-text-label` was retired into `--lc-text-muted` on 2026-09-06 (same
 * value; see tokens.css), and this list kept asking for it, so the gate
 * failed on every run from then on -- a gate that always fails checks
 * nothing. Found 2026-09-22 running it for the font change.
 */
const READABLE_TEXT = ['--lc-text-primary', '--lc-text-secondary', '--lc-text-muted']
const SURFACES = [
  '--lc-bg-window',
  '--lc-bg-chrome',
  '--lc-bg-sidebar',
  '--lc-bg-raised',
  '--lc-bg-raised-2',
  '--lc-bg-selected',
  '--lc-bg-bubble-user',
  '--lc-bg-bubble-peer'
]
const AA = 4.5

function check(tokensCss, componentFiles, shellCss = '') {
  const failures = []
  const tokens = parseTokens(tokensCss)

  for (const name of [...READABLE_TEXT, ...SURFACES]) {
    if (!tokens.has(name)) failures.push(`missing token ${name}`)
  }
  if (failures.length > 0) return failures

  for (const text of READABLE_TEXT) {
    for (const surface of SURFACES) {
      const ratio = contrastRatio(tokens.get(text), tokens.get(surface))
      if (ratio < AA) {
        failures.push(`${text} on ${surface} is ${ratio.toFixed(2)}:1, below ${AA}:1`)
      }
    }
  }

  // The faint token is explicitly non-text. Assert it really would fail, so the
  // rule that keeps it off copy is documented by a measurement rather than a
  // comment -- and so a future edit that "fixes" it gets noticed.
  const faint = tokens.get('--lc-text-faint')
  if (faint !== undefined) {
    const ratio = contrastRatio(faint, tokens.get('--lc-bg-sidebar'))
    if (ratio >= AA) {
      failures.push(
        `--lc-text-faint now passes AA (${ratio.toFixed(2)}:1); it is documented as non-text only, so either promote it deliberately or restore the value`
      )
    }
  }

  for (const [file, source] of componentFiles) {
    for (const hex of source.match(HEX) ?? []) {
      failures.push(`${file}: literal color ${hex} -- use a token`)
    }
  }

  failures.push(...faintTextFindings('shell.css', shellCss))
  for (const [file, source] of componentFiles) {
    if (file.endsWith('.css')) failures.push(...faintTextFindings(file, source))
  }

  // A custom property nobody defines is not an error in CSS -- the
  // declaration is simply dropped, so the element keeps whatever it
  // inherited and the page looks almost right. MEASURED 2026-09-05: two new
  // rules shipped `color: var(--ink-faint)`, a token from a different
  // project's stylesheet, and this gate passed because it only knew how to
  // look for the faint token by name. Every var() a stylesheet uses must be
  // one this app defines.
  const defined = new Set([...`${tokensCss}\n${shellCss}`.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]))
  for (const [file, source] of [['shell.css', shellCss], ...componentFiles]) {
    if (!file.endsWith('.css')) continue
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
      // A var() with a fallback still paints something, so it is not a silent drop.
      if (!defined.has(match[1]) && !new RegExp(`var\\(\\s*${match[1]}\\s*,`).test(source)) {
        failures.push(`${file}: var(${match[1]}) is never defined -- the declaration is silently dropped`)
      }
    }
  }

  const appSurfaceText = `${tokensCss}\n${componentFiles.map(([, source]) => source).join('\n')}`.toLowerCase()
  for (const banned of FORBIDDEN_IN_APP) {
    if (appSurfaceText.includes(banned)) {
      failures.push(`${banned} is a documentation-only gray and must not appear in the app`)
    }
  }

  return failures
}

function loadComponents() {
  return walk(COMPONENTS).map((file) => [relative(ROOT, file), readFileSync(file, 'utf8')])
}

const tokensCss = readFileSync(TOKENS, 'utf8')

if (process.argv.includes('--self-test')) {
  // A gate nobody has seen go red is not evidence. Plant each class of
  // violation and require detection.
  const cases = [
    [
      'a literal color in a component',
      tokensCss,
      [['fake/Component.tsx', 'const c = "#ff0000"']],
      /literal color/
    ],
    [
      'a text token that fails AA',
      tokensCss.replace('--lc-text-muted: #8b9190;', '--lc-text-muted: #4a4f4f;'),
      [],
      /below 4.5:1/
    ],
    [
      'a documentation-only gray inside the app',
      tokensCss,
      [['fake/Component.tsx', 'color: var(--x) /* #616666 */']],
      /documentation-only gray/
    ],
    [
      'the faint token used as text color',
      tokensCss,
      [['fake/Component.css', '.lc-madeup {\n  color: var(--lc-text-faint);\n}']],
      /fails AA on text/
    ]
  ]
  let bad = 0
  for (const [label, css, components, pattern] of cases) {
    const failures = check(css, components)
    const caught = failures.some((failure) => pattern.test(failure))
    if (!caught) bad += 1
    console.error(`  [${caught ? 'CAUGHT' : 'MISSED'}] ${label}`)
  }
  const clean = check(tokensCss, loadComponents(), readFileSync(SHELL, 'utf8'))
  if (clean.length > 0) {
    bad += 1
    console.error(`  [MISSED] a compliant tree must produce zero findings; got: ${clean.join('; ')}`)
  } else {
    console.error('  [CAUGHT] a compliant tree produces zero findings')
  }
  console.error(`\n${bad === 0 ? 'TOKEN GATE SELF-TEST PASSED' : `${bad} SELF-TEST FAILURE(S)`}`)
  process.exit(bad === 0 ? 0 : 1)
}

const failures = check(tokensCss, loadComponents(), readFileSync(SHELL, 'utf8'))
for (const failure of failures) console.error(`  [FAIL] ${failure}`)
console.error(failures.length === 0 ? 'TOKEN GATE PASSED' : `TOKEN GATE FAILED (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
