# Feature spec — Generative teammate avatars

Self-contained. Implement in the renderer only; no main-process, IPC, or ledger changes. Visual reference: the teammate chips in `Locust Desktop.dc.html` (sidebar, workroom header, thread, roster, compact rail, create dialog).

## What this replaces

- Initials-in-a-box teammate chips → generated pixel faces.
- The indeterminate progress bar / loading bar in the live step card → the working teammate's own motion (see Working indicator below). Keep the step name, elapsed time and counters; never reintroduce a bar, spinner or percentage.

## Working indicator — the avatar IS the progress UI

No bars, no spinners, no percentages anywhere in the thread. A running step is a **single line** whose motion comes from the teammate. Two treatments, chosen by the *kind* of step, so the motion itself tells the user what sort of work is happening:

### Tool step (shell, tests, file edits, HTTP) — the avatar works

24px avatar running all three animations (`lcBob` + `lcEyes` + `lcChat`), then step name, a 1px × 13px hairline divider (`rgba(255,255,255,0.10)`), then mono counters.

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 0" }}>
  <Avatar spec={teammate.avatar} size={24} activity="working" />
  <span style={{ fontSize: 13, color: "#E4EFC7" }}>{step.label}</span>
  <span style={{ width: 1, height: 13, background: "rgba(255,255,255,0.10)", display: "block" }} />
  <span style={{ fontFamily: "Geist Mono, monospace", fontSize: 11.5, color: "#8B9190" }}>
    {step.position} · {elapsed} · {step.counters}
  </span>
</div>
```

### Reasoning step (planning, deciding, reading) — the avatar thinks

Same 24px avatar but **static** (thinking is not doing), followed by three 4px lime dots that rise and brighten in sequence, then the step label, with elapsed + counters pushed right by `margin-left: auto`.

```css
@keyframes lcDot {
  0%, 100% { opacity: .25; transform: translateY(0); }
  50%      { opacity: 1;   transform: translateY(-2px); }
}
/* dots use one keyframe, staggered by delay: 0s, .18s, .36s — 1.4s ease-in-out infinite */
```

### Rules

- One indicator per running step; it occupies the position where the streamed reply will appear, so nothing jumps when text arrives.
- On completion the line is **replaced** by the collapsed activity card (`Edited 3 files · ran 2 commands · 28s`), never left behind at 100%.
- Counters are real values from the runtime (tests passed/failed, files touched, bytes) — never a synthetic percentage, because step duration is not knowable in advance.
- Elapsed time is always shown; it is the honest substitute for a progress bar.
- Under `prefers-reduced-motion` both treatments become static: the line still reads as active from its text and the live presence dot.

Switch the two treatments in the reference with the **Working** control in the top strip (Live work state).

## Data model

Persist the face on the teammate record. Never re-derive it from a mutable field (a rename must not change a face).

```ts
type AvatarSpec = {
  hue: "lime" | "blue" | "violet" | "coral";
  headwear: 0 | 1 | 2 | 3 | 4 | 5;   // plain, cans, bangs, buns, cap, antenna
  accessory: 0 | 1 | 2;              // none, goggle frame, brows
  mouth: 0 | 1 | 2 | 3;              // line-2, line-4, open, smirk
};
```

Seed defaults from the immutable teammate **id** on creation, then let the user override:

```ts
const HUES = ["lime", "blue", "violet", "coral"] as const;

function seedAvatar(id: string): AvatarSpec {
  let h = 2166136261;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const n = (shift: number, mod: number) => ((h >>> shift) & 0xff) % mod;
  return { hue: HUES[n(0, 4)], headwear: n(4, 6) as AvatarSpec["headwear"],
           accessory: n(12, 3) as AvatarSpec["accessory"], mouth: n(20, 4) as AvatarSpec["mouth"] };
}
```

≈288 distinct faces from four hue pairs. Scale by adding hues, not by drawing new faces.

## Geometry

8×8 cell grid. Pixel size `p = max(2, round(size * 0.72 / 8))`; the grid box is `p * 8` square, centered in the chip with `overflow: hidden`. Chip radius `max(4, round(size / 6))`. Cell coordinates below use an even 0–14 scale — `left = x / 2 * p`, `top = y / 2 * p`.

Sizes in use: 16 inline · 20–26 thread · 28–32 header/sidebar/rail · 36 roster · 56 empty state and create dialog.

## Parts

```ts
const HEADWEAR = [
  [],                                                                    // plain
  [[2,2],[4,2],[6,2],[8,2],[10,2],[12,2],[0,4],[0,6],[14,4],[14,6]],     // cans
  [[2,2],[4,2],[6,2],[8,2],[10,2],[12,2]],                               // bangs
  [[4,2],[6,2],[8,2],[10,2],[0,4],[0,6],[14,4],[14,6]],                  // buns
  [[4,0],[6,0],[8,0],[10,0],[2,2],[4,2],[6,2],[8,2],[10,2],[12,2]],      // cap
  [[6,0],[6,2],[4,4],[6,4],[8,4],[10,4]]                                 // antenna
];
const ACCESSORY = [[], [[2,6],[12,6]], [[2,4],[12,4]]];                  // none, goggle frame, brows
const MOUTH = [
  [[6,10],[8,10]],                       // line-2
  [[4,10],[6,10],[8,10],[10,10]],        // line-4
  [[6,10],[8,10],[6,12],[8,12]],         // open
  [[6,10],[8,12]]                        // smirk
];
const EYES = [[4,6],[10,6]];             // always these two cells

const HUE = {
  lime:   { chip: "#A9D93F", px: "#151A0C", border: "rgba(201,240,74,0.55)" },
  blue:   { chip: "#5E9BF0", px: "#0D1520", border: "rgba(110,168,254,0.5)" },
  violet: { chip: "#A98BE8", px: "#150F1E", border: "rgba(186,150,240,0.5)" },
  coral:  { chip: "#E4857A", px: "#1E100F", border: "rgba(228,104,93,0.5)" }
};
```

## Rendering

Four DOM nodes maximum per face. Each layer is **one** span: a single base pixel at its first cell, with every remaining pixel emitted as a `box-shadow` offset. This keeps faces cheap at any count and crisp at any size (no SVG, no images, no emoji).

1. `features` — `HEADWEAR[headwear].concat(ACCESSORY[accessory])`, static
2. `highlight` — optional, 45–60% white pixels (hair streak / visor glint), static
3. `eyes` — `EYES`, animated, `transform-origin: center`
4. `mouth` — `MOUTH[mouth]`, animated, `transform-origin: center top`

```tsx
function Layer({ cells, color, p, animation, origin }: LayerProps) {
  if (!cells.length) return null;
  const [bx, by] = cells[0];
  const shadow = cells.slice(1)
    .map(([x, y]) => `${(x - bx) / 2 * p}px ${(y - by) / 2 * p}px 0 ${color}`)
    .join(", ");
  return <span style={{ position: "absolute", left: bx / 2 * p, top: by / 2 * p,
    width: p, height: p, background: color, boxShadow: shadow || undefined,
    transformOrigin: origin, display: "block", animation }} />;
}
```

Mark the chip `aria-hidden` — identity comes from the adjacent name text.

## Activity — the important rule

**A face animates only while that teammate is actually doing something.** Motion is a status signal; if it runs when a teammate is idle it becomes decoration and stops meaning anything.

| Teammate state | Animations |
| --- | --- |
| working / streaming | `lcBob` + `lcEyes` + `lcChat` |
| receiving a peer message | `lcEyes` only |
| idle · approval-pending · blocked · signed-out · completed · cancelled | **none** — perfectly still |

```css
@keyframes lcBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7%); } }
@keyframes lcEyes {
  0%, 34% { transform: translateX(0) scaleY(1); }
  38%     { transform: translateX(0) scaleY(0.12); }   /* blink */
  43%     { transform: translateX(0) scaleY(1); }
  54%, 66% { transform: translateX(100%) scaleY(1); }  /* glance right */
  76%, 84% { transform: translateX(-100%) scaleY(1); } /* glance left */
  92%, 100% { transform: translateX(0) scaleY(1); }
}
@keyframes lcChat { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.45); } }
```

Timings: `lcBob 2.6s ease-in-out infinite` on the chip, `lcEyes 5s ease-in-out infinite` on the eye layer, `lcChat 1.5s ease-in-out infinite` on the mouth layer.

`translateX(100%)` equals exactly one pixel because the eye layer is `p` wide — one keyframe set works at every avatar size with no per-size values.

Wrap everything in `@media (prefers-reduced-motion: reduce) { animation: none }`. Because motion can be off, **status must also be legible from text and the presence dot alone** — never encode state in animation only.

## Presence dot

8px circle, bottom-right, 2px ring in the surrounding surface color: lime working · amber approval-pending · red blocked/signed-out · none when idle.

## Create / edit dialog

Sidebar `+` and the roster's "New teammate" card open the same dialog: name field, hue swatches, live 56px preview, **Shuffle look** (advances headwear/accessory/mouth), role grid, default route + approval mode summary. The preview animates so the user sees the working behavior. Editing an existing teammate reuses it.

## Acceptance checks

1. Two teammates with the same display name but different ids get different faces; renaming a teammate never changes its face.
2. In a live mission, exactly one avatar animates — the working teammate; every other chip has `animationName: "none"`.
3. Idle, approval-pending, blocked and completed teammates are static in **every** surface: sidebar, header, thread, roster, and the compact rail.
4. Faces stay crisp and centered at 16, 20, 26, 32, 36 and 56px.
5. With reduced motion enabled, nothing animates and every state is still readable.
6. No progress bar, spinner or percentage remains anywhere in the thread; a finished step collapses into the activity card rather than sitting at 100%.
7. A tool step shows the animated-avatar line; a reasoning step shows the static avatar + staggered dots.
