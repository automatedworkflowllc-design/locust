# Locust design system — handover

**Artifact:** https://claude.ai/artifact/WcEj8AVt4QckXNHN7EXtbG
**Built from:** `automatedworkflowllc-design/Locust` @ `main a6df5bb`, 2026-09-21
**Companion doc:** `DESIGN-SYSTEM-REVIEW-2026-09-21.md` (open findings, five of them)

This is an extraction of the design system that already exists in the Locust desktop
app, published as a readable, renderable design system. It was built by reading the
repository — not by inventing anything — and every value in it is traceable to a file
and a line.

Read §3 before using it for anything. It is the one part that will cause damage if
skipped.

---

## 1. What is in it

| | |
|---|---|
| Tokens | **131** — 91 colours (one dark theme), 8 spacing, 4 radii, 5 shadows, 12 type-size/tracking, 4 timing, 7 layout |
| Type | 3 families, 9 font files (real binaries, licences beside them), 11 text styles |
| Components | **21 cards.** 15 mount the real code; **12 distinct components** are exported by the bundle |
| CSS patterns | 5 cards (`Button`, `Card`, `Bubble`, `SearchField`, `StatusDot`) — real markup and class names, because no React component exists for them in the repo |
| Assets | 6 brand marks (mark, wordmark, three lockups, app icon), uploaded as real files |
| Stylesheet | `components/bundle.css` = `shell.css` **verbatim** (317 KB) plus a 3-line bridge |
| Bundle | `components/bundle.js`, 55.8 KB, classic script, reads `window.React`, assigns `window.Locust` |

**The 12 live components:** `Icon`, `PixelFace`, `Orb`, `TitleBar`, `TimeMarker`,
`HandoffDivider`, `ContextRing`, `DiffView`, `DecisionCard`, `ResumeCard`,
`ApprovalCard`, `ActivityCard`.

The bundle also exports the state machine — `FACE_MOTION`, `faceLabel`, `isMotionless`,
`teammateActivity`, `ORB_BOX` — and the pure helpers `parseUnifiedDiff`, `fileCounts`,
`seedAvatar`, `shuffledAvatar`. Previews use those to build their own fixtures, so no
preview hand-shapes data the component would never actually receive.

---

## 2. What it was built from

Every token, rule and component came from these files. Nothing was taken from a
screenshot, and nothing was approximated.

| Source | What came out of it |
|---|---|
| `apps/desktop/src/renderer/src/tokens.css` | every token, with its usage note taken from the comment on the line |
| `apps/desktop/src/renderer/src/shell.css` | `bundle.css`, verbatim |
| `apps/desktop/src/renderer/src/components/*.tsx` | the 12 bundled components |
| `apps/desktop/src/renderer/src/faceState.ts` | the nine face states and their animations |
| `apps/desktop/src/shared/avatar.ts` | the avatar grid, parts library and seeding rule |
| `design/locust-desktop/HANDOFF.md` | the usage rules, the IA, the state vocabulary |
| `design/locust-desktop/AVATARS.md` | avatar motion timings |
| `brand/*.svg`, `brand/README.md` | the marks and the "no small-size mark" limitation |
| `apps/desktop/src/renderer/src/assets/fonts/` | the 9 font binaries and 3 licences |

---

## 3. Source of truth — read this one

**The repository wins. Always.**

`apps/desktop/src/renderer/src/tokens.css` is the only source of truth for tokens. The
artifact's `tokens.json` is a *derived copy*, published so the system can be read and
rendered outside the repo. If the two ever disagree, the repo is right and the artifact
is stale.

Practically, that means:

- **Never edit tokens in the artifact and port them back.** The flow is one-way:
  `tokens.css` → artifact. §7 covers re-syncing.
- **Never add a token to the artifact that does not exist in the repo.** It will look
  official and be fiction.
- **Inside the Locust repo, consume `tokens.css` directly.** The artifact adds nothing
  there except documentation. `_qa/token-gate.mjs` already fails the build on a literal
  hex; that gate is the real enforcement and the artifact does not replace it.
- **Outside the Locust repo** — `locust-site`, marketing, companion apps — the artifact
  *is* the package, because those repos have no `tokens.css`. Note that
  `locust-site/app/globals.css` currently holds a hand-copied 13-variable subset of the
  palette, which will drift from the app. Generating it from `tokens.css` is the durable
  fix and has not been done.

---

## 4. How an agent should read it

The artifact serves its files by path. Read them in this order and stop when you have
what you need:

1. **`project/README.md`** — always first. It is the brand book, and its generated tail
   indexes every other file.
2. **`project/components/<Name>/README.md`** — the rules for one component: when to use
   it, what the consumer supplies, and the do-nots.
3. **`project/components/index.d.ts`** — props, as documentation.
4. **`project/tokens.json`** / **`project/tokens.css`** — hand to tooling; do not read
   into context, they are long and flat.

**Do not read the artifact's page, and do not start with a file listing.** The page is a
~1.7 MB application shell; reading it burns the context the rules were meant to occupy
and tells you nothing the README does not.

Everything under `project/` is content. Everything under `artifact-type/` and the root
`SKILL.md` belong to the artifact template, not to Locust — ignore them.

**Access:** the artifact is private. Nothing can read it until it is shared from the
page's Share menu.

---

## 5. What is real, and what is a rendition

Worth being precise about, because "it's in the design system" should mean something
specific.

**Real code, running:** the 12 components listed in §1. They were bundled from the
repository's own `.tsx` sources with esbuild — not re-authored, not re-typed. Their
previews mount them with realistic props. `ApprovalCard` renders an actual unified diff
through the real `DiffView`; `ActivityCard` opens on real file, shell and reasoning rows.

**Real markup, no component:** `Button`, `Card`, `Bubble`, `SearchField`, `StatusDot`.
These are CSS patterns — the repo styles them in `shell.css` but has no React component
for them. Their previews use the true class names and are styled by the real stylesheet,
so they are accurate, but there is nothing to import.

**Mixed:** `SidebarRow` and `AgentLine` are pattern markup with the real `PixelFace`
mounted inside, which is exactly how the app composes them.

**One deliberate deviation:** the `Orb` card draws at a 48px box so the nine shapes are
legible in a documentation context. The shell uses `ORB_BOX`, which is **26**. The
card's README says so explicitly.

**React version:** the bundle runs on React 18, because that is the last version with a
UMD build a preview can load as a classic script. The app is React 19. The components
taken here use only `useState`, `useMemo`, `useEffect`, `useRef` and `Fragment`, so
nothing depends on the difference — but do not assume the bundle exercises React 19
behaviour.

---

## 6. The standing rules

The full versions are in `project/README.md`. This is the set worth having in working
memory before touching the renderer.

- **`--lc-text-muted` (`#8B9190`) is the dimmest colour allowed on any readable string,
  at any size.** `--lc-text-faint` and `--lc-neutral` are non-text only — icon strokes,
  separators, hairline marks, inert dots.
- **Lime means "happening right now" and nothing else.** Green means settled: allowed,
  passed, added, available. They were one colour once and neither read.
- **Card weight tracks who is waiting, not severity.** `is-pending` blocks work and is
  raised with a shadow; `is-terminal` already happened and is recessed. A failure that
  still needs a decision keeps the recessed fill and emphasises its buttons.
- **Cards use borders, never shadows.** The entire elevation budget is popovers, the
  palette, the window, and the two card weights.
- **No progress bar, spinner or percentage in the thread.** The working teammate's own
  avatar motion is the activity indicator — that is what replaced the bar.
- **Motion means now.** Nine face states from `faceState.ts`, resolved once by
  `teammateActivity()` and handed to every surface. `idle` and `blocked` are the only
  motionless states and must stay so. Everything stops under
  `prefers-reduced-motion: reduce`, so no state may be carried by motion alone.
- **Copy follows state.** Use `faceLabel()`. A row reading "working" beside a still,
  waiting face is the same defect as two faces disagreeing, just in words.
- **Focus is `:focus-visible` only**, 2px ring at 2px offset — never a sticky ring after
  a mouse click. A field is the exception and takes the soft no-hue treatment
  (`--lc-focus-edge` + `--lc-focus-glow`). Put the ring on the wrapper a person can see,
  not on a bare input whose outline is suppressed.
- **Numbers shown together come from one source.** `DiffView` derives the `@@` line, the
  fold counts and the footer from the same rows, so a reviewer cannot be shown three
  numbers that disagree.
- **Consume tokens, never a literal colour.** A raw hex in a component is a review
  defect and `_qa/token-gate.mjs` fails the build on one.

---

## 7. Re-syncing when the code changes

The artifact does not update itself. When `tokens.css`, `shell.css` or a bundled
component changes, it goes stale silently.

**Merge, never rebuild.** A re-sync updates changed values and adds what is new, but
**keeps** the usage notes, the README prose and the component guidelines — those are
written, not derived, and a rebuild throws them away.

Order of work:

1. Read the artifact's `project/design-system.json` (the index) and every file you are
   about to change.
2. Re-read the repository at the ref you are syncing to. Diff `tokens.css` against
   `tokens.json`: changed values get updated, new variables get added **with a usage
   note**, and variables the code no longer defines get **listed and asked about**, not
   silently dropped.
3. Rebuild `bundle.css` (copy `shell.css`, re-apply the 3-line bridge in §9) and
   `bundle.js` (§9).
4. Update `tokens.json`'s `meta` block — `repo`, `ref`, `synced` — and the index's
   `lastChange`.
5. Publish only the files that changed. The index goes last.

**Do not** send `index.html`, `SKILL.md` or anything under `artifact-type/`. Those belong
to the artifact template and publishing over them is refused.

---

## 8. Known gaps

Stated so nobody assumes coverage that is not there.

- **Component families with no card:** `Composer` and its menus, `RoutePicker`,
  `CommandPalette`, `Inspector` / `SignalRail`, `PeerThread`, `ExchangeStrip`,
  `NewTeammateDialog`, `FirstLaunch`, `BootScreen`, `MemoryCard`, `CancellationCard`,
  `RoutineDialog`, `FileViewer`, and the three screens.
- **The boot tube has tokens but no card.** `lc-boot-*` is eleven real tokens with their
  own keyframes (`lcBootFlicker`, `lcBootSweep`, `lcBootCaret`, `lcBootPulse`); nothing
  in the artifact draws it.
- **One theme only.** Dark, by construction. There are no light values, and the ~12
  white-alpha border tokens do not invert — they disappear.
- **No app-icon raster.** The PNGs under `design/locust-desktop/brand/app-icon/` were
  left out; the rounded SVG is included.
- **No chart or data-visualisation palette.** The app has none, so the system has none.

---

## 9. Rebuilding the bundle

The build was run from a scratch directory outside the repo, with `esbuild` and
`thinking-orbs` installed locally. No repo install is needed — the whole dependency
graph is local except `thinking-orbs`, which is bundled in.

**Setup**

```bash
mkdir lcbuild && cd lcbuild
npm init -y && npm i esbuild thinking-orbs
npm i react@18 react-dom@18   # smoke test + local render harness only
```

**Three shims.** React comes from the page as a global, never bundled.

`shim-react.js` re-exports `globalThis.React`'s named exports (`Fragment`, `useState`,
`useEffect`, `useRef`, `useMemo`, `createElement`, …). `shim-react-dom.js` does the same
for `globalThis.ReactDOM`. `shim-jsx.js` implements the automatic runtime:

```js
const R = globalThis.React
export const Fragment = R.Fragment
export function jsx(type, props, key) { /* one child → third arg */ }
export function jsxs(type, props, key) {
  const children = (props ?? {}).children
  // STATIC children must be SPREAD, not passed as one array child —
  // otherwise React demands keys for markup the real runtime treats as static,
  // and every preview logs a key warning.
  return Array.isArray(children)
    ? R.createElement(type, rest, ...children)
    : jsx(type, props, key)
}
```

**esbuild config.** The one non-obvious part is that this codebase writes relative
imports with a `.js` extension onto `.ts`/`.tsx` files on disk, so a resolver plugin is
required:

```js
build({
  entryPoints: ['entry.ts'],       // re-exports the 12 components + helpers
  bundle: true,
  format: 'iife',
  globalName: 'Locust',            // → window.Locust
  minify: true,
  target: ['es2020'],
  jsx: 'automatic',
  jsxImportSource: 'locustjsx',    // → shim-jsx.js
  define: { 'process.env.NODE_ENV': '"production"' },
  absWorkingDir: HERE,
  nodePaths: [path.join(HERE, 'node_modules')],  // sources live outside this folder
  plugins: [{
    name: 'locust',
    setup(api) {
      // react / react-dom / jsx-runtime → the shims
      // @teammate/* → empty stub (imported for types only)
      // ./foo.js → ./foo.ts or ./foo.tsx
    }
  }]
})
```

Then prepend the bundle header and reject the two sequences a consumer cannot inline:

```js
/* @ds-bundle: {"format":4,"namespace":"Locust","components":[{"name":"Icon"}, …]} */
// then: throw if the output contains "</script" or "<!--"
```

**Verify before publishing — both steps.**

1. **Smoke test.** Load the bundle in `node:vm` with React 18 in the context, mount every
   export with real props, and render with `react-dom/server`. This is what caught the
   `'streaming'` bug (see §10) and a JSX-shim defect that would have logged a React key
   warning in every preview.
2. **Look at it.** Compile `tokens.json` to a `tokens.css`, serve each preview as a real
   document with the fonts, `bundle.css`, React UMD and `bundle.js` preloaded — the same
   preload the artifact frame gives them — and open it in a browser. Several problems
   here were only visible rendered, including the first cover, which was unusable.

**`bundle.css`** is `shell.css` copied byte-for-byte, preceded by this bridge and nothing
else. Every other Locust token compiles out of `tokens.json` under its own name; the
three font stacks are the only ones that do not, because a design system emits a family
as `--font-<key>`:

```css
:root {
  --lc-font-ui: var(--font-ui);
  --lc-font-mono: var(--font-mono);
  --lc-font-prose: var(--font-prose);
}
```

---

## 10. Correction to an existing repo doc

**`design/locust-desktop/HANDOFF.md` §3 "Avatar activity" is superseded by
`faceState.ts` and still reads as current.**

The handoff documents three animations (`lcBob`, `lcEyes`, `lcChat`) over two states
(working, streaming). The shipped code has **nine** states with a different animation set
— `lcTilt`, `lcBob2`, `lcEyesUp`, `lcEyesDown`, `lcEyesFwd`, `lcStare`, `lcGlance`,
`lcHop`, plus `lcRingWait` for `waiting`.

There is no `streaming` state. The nearest equivalent is `responding`.

This is not academic: anything generated from the handoff's table will reference states
that do not exist, and `FACE_MOTION['streaming']` is `undefined`, so reading `.chip` off
it throws. That exact bug reached a preview in this extraction before the render check
caught it.

Recommend either updating §3 or marking it superseded.

---

## 11. Open review

`DESIGN-SYSTEM-REVIEW-2026-09-21.md` carries five findings against the system itself,
each with its measurement, a one-line fix, and the case against making the change:

1. The focus ring is the same token as "live" — breaks the system's own lime rule
2. `--lc-neutral` measures 2.12:1 and paints status dots — below the 3:1 non-text floor
3. Blue and violet have identical lightness and the lowest separation in the palette
4. The `13.5` / `13` type step did not survive the argument that retired its siblings
5. `--lc-text-faint` and `--lc-neutral` are named for how they look, not what they do

**Findings 2 and 5 are safe to apply directly.** Findings 1, 3 and 4 touch brand or
density decisions that were made deliberately — take those back as proposals, and read
the "case against" section of each before acting.
