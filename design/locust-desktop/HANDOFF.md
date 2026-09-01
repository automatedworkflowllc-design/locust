# Locust Desktop — Design Handoff

**Visual reference:** `Locust Desktop.dc.html` (open in a browser; the strip above the window switches every state and screen).
**Brand assets:** `brand/locust-mark.svg`, `brand/locust-wordmark.svg`, `brand/locust-logo-on-dark.svg`.

This document is the complete spec for implementing the redesigned primary shell in the existing Electron + React + TypeScript app. It assumes the reader has repo access and this project does not — every runtime/mission/route value shown in the reference is illustrative and must be bound to real state.

---

## 1. Product principle

**Teammates are the product.** The default surface is calm and human: pick a teammate, talk to them, watch work happen. All execution depth (events, checkpoints, permissions, receipts, raw logs) still exists but is **progressively disclosed** — never permanently on screen.

**Trust is the differentiator.** At any moment the user must be able to answer: which teammate, which runtime, which model/route, what tools, what needs approval, and what state the run is in (restored / interrupted / checkpointed / switched / failed / completed). Nothing may claim a capability that discovery hasn't proven.

---

## 2. Information architecture

```
Workroom (home)      selected teammate + mission thread          default
Teammates            roster; role, default route, tools, mode
Missions             local mission history + receipt status
Settings             runtimes, routes, fallback, permissions, privacy, retention, cloud (planned)
```

- **Sidebar (268px)** — brand row (mark + wordmark, `+` **new teammate**), Search field, Teammates list (selected teammate expands to show its recent missions), Recent missions, Settings pinned at the bottom with a live-connection count.
- **Connections is *not* a top-level destination.** It lives in Settings; the composer `+` menu links into it.
- **Workroom (fluid)** — teammate header (avatar, name, role, mission line, Activity toggle), thread, composer.
- **Inspector (344px)** — closed by default; opens for Activity / Details / Artifacts / Receipt. Contains the Signal Rail and the Tools & permissions block, with "Raw event log" one level deeper.
- **Command palette** — overlay, `⌘K`. Groups: Missions, Runtime, Go to.

### Screen ↔ component map (suggested)

| Region | Component | Notes |
| --- | --- | --- |
| Sidebar | `WorkspaceSidebar` | `BrandRow`, `SearchField`, `TeammateList`, `TeammateRow`, `MissionRow`, `SettingsRow` |
| Workroom | `Workroom` | `TeammateHeader`, `MissionThread`, `Composer` |
| Thread items | `ThreadItem` variants | `UserMessage`, `AgentMessage`, `PlanCard`, `ActivityCard`, `LiveStepCard`, `ApprovalCard`, `QuestionCard`, `PeerThread`, `ArtifactCard`, `LimitCard`, `CancelCard`, `LedgerFailureCard`, `ReceiptCard`, `HandoffDivider` |
| Composer | `Composer` | `ModeMenu`, `AddMenu`, `RoutePicker`, `EffortMenu`, `SwarmToggle`, `SendStopButton` |
| Inspector | `MissionInspector` | `SignalRail`, `PermissionSummary` |
| Overlays | `CommandPalette`, `NewTeammateDialog` | |
| Screens | `MissionsScreen`, `TeammatesScreen`, `SettingsScreen` | Settings uses a left sub-nav + panel |

Break `App.tsx` along these seams. Keep IPC/runtime adapters outside the view layer; every component above should take normalized props from the existing mission/runtime contracts.

---

## 3. Design tokens

Author these once (CSS custom properties or a TS token module) and consume everywhere. Values are exact from the reference.

### Color — surfaces
| Token | Value | Use |
| --- | --- | --- |
| `bg/app` | `#0B0D0E` | desktop behind the window |
| `bg/window` | `#121415` | app body |
| `bg/chrome` | `#16191A` | title bar, headers |
| `bg/sidebar` | `#17191A` | sidebar |
| `bg/raised` | `#191C1D` | cards, list rows |
| `bg/raised-2` | `#1B1E1F` | menus, popovers, search field |
| `bg/selected` | `#1E2223` | selected sidebar item, active tab |
| `bg/bubble-user` | `#23282A` | user message bubble |
| `bg/bubble-peer` | `#202324` | teammate-to-teammate bubble |
| `border/hairline` | `rgba(255,255,255,0.06)` | structural 1px dividers |
| `border/card` | `rgba(255,255,255,0.07)` | card + row borders |
| `border/strong` | `rgba(255,255,255,0.11)` | popovers, emphasized controls |
| `overlay/scrim` | `rgba(8,10,10,0.55)` | palette scrim |

### Color — text
| Token | Value | Use |
| --- | --- | --- |
| `text/primary` | `#F2EFE9` / `#F1EEE8` | warm white body + headings |
| `text/secondary` | `#C7C3BC` | control labels, secondary values |
| `text/muted` | `#8B9190` | metadata, descriptions, mono provenance — the AA floor for all in-app text |
| `text/faint` | `#7A807F` | **non-text only** — icon strokes, the `/` separator glyph, hairline marks. Never used for readable copy (4.2–4.4:1 fails AA). |
| `text/label` | `#8B9190` | section labels, menu group headers, placeholders — **AA floor for in-app text** |
| `text/annotation` | `#616666` / `#4E5353` | documentation captions *outside* the app window only |

### Color — semantics
| Token | Value | Meaning |
| --- | --- | --- |
| `accent/lime` | `#C9F04A` | active, ready, live, allowed. Text-on-dark variant `#DBF785`, tint `rgba(201,240,74,0.10–0.20)`, border `rgba(201,240,74,0.30–0.55)` |
| `state/blue` | `#6EA8FE` (text `#9DC2FB`) | informational, checkpoints, peer/inbound, API routes |
| `state/amber` | `#E9B949` (text `#EFC969`) | needs approval, interrupted, preview-only, untrusted |
| `state/red` | `#E4685D` (text `#EE9188`) | failure, denied, sign-in required, destructive |
| `state/violet` | `#BA96F0` | model switches, shell/tool events |
| `state/neutral` | `#4A4F4F` | unavailable / inert |

**Rule:** lime is the only decorative-ish color and only for *active/ready*. Blue/amber/red must carry meaning — never used for hierarchy or delight.

### Teammate avatar palette (8-bit faces)
Each teammate = a rounded square in its hue with a **CSS-pixel face** (one 2–5px base pixel + `box-shadow` offsets on an 8×8 grid, pixel size = `round(size × 0.72 / 8)`). Crisp at every size; no SVG, no emoji.

| Teammate | Chip | Face pixels | Grid cells (x,y on 0–14 even) |
| --- | --- | --- | --- |
| Wren | `#A9D93F` | `#151A0C` | cropped hair `(2,0)(4,0)(6,0)(8,0)(10,0)(12,0)(2,2)(12,2)`, eyes `(4,6)(10,6)`, mouth `(6,10)(8,10)` |
| Atlas | `#5E9BF0` | `#0D1520` | bangs `(4,2)(6,2)(8,2)(10,2)`, eyes `(4,6)(10,6)`, flat mouth `(4,10)(6,10)(8,10)(10,10)` |
| Juno | `#A98BE8` | `#150F1E` | cowlick `(12,0)(12,2)`, eyes `(4,6)(10,6)`, open mouth `(6,10)(8,10)(6,12)(8,12)` |
| Sable | `#E4857A` | `#1E100F` | brows `(2,2)(4,2)(10,2)(12,2)`, eyes `(4,6)(10,6)`, mouth `(6,10)(8,10)` |

Sizes used: 16 (inline), 20–24 (thread), 28–32 (header, sidebar, rail), 36 (roster), 56 (empty state). Border = chip hue at 50% alpha. Presence dot (8px, 2px window-colored ring) pins to bottom-right in the compact rail.

### Typography
- UI: **Geist** (fallback Helvetica → system sans). Weights 400/500 only — no bold headings inside the app.
- Technical provenance: **Geist Mono** — model ids, paths, timestamps, event names, checkpoint ids, section labels.
- Minimum readable in-app text is 12px (10–10.5px only for uppercase mono section labels, which must use `#8B9190`).
- Scale: 15px screen title · 14.5px teammate name · 13.5px body/bubbles · 13px control labels and card titles · 12.5px secondary/metadata · 12px descriptions · 11.5px mono provenance · 11px mono captions · 10–10.5px mono uppercase section labels (`letter-spacing: .14–.16em`).
- **Floor: 10px, and only for uppercase mono labels.** Everything readable is ≥12px. Line-height 1.5–1.6 on prose; `text-wrap: pretty` on paragraphs.

### Spacing, radii, elevation, motion
- 8px system; 2/4/6px allowed for icon gaps and pixel-face internals.
- Radii: 6–7px small controls · 8px buttons/rows · 9–10px cards · 11–13px popovers and the window · 50% dots.
- Elevation: only popovers/overlays get shadow — `0 24px 60px rgba(0,0,0,0.6)` (menus), `0 40px 100px rgba(0,0,0,0.65)` (palette), `0 32px 80px rgba(0,0,0,0.55)` (window). Cards use borders, never shadows.
- Motion: 120ms press, 140ms hover/color, 180ms panel open. Keyframes: `lcPulse` (live dot, 1.6s), `lcCaret` (streaming caret, 1s step-end), `lcBar` (indeterminate progress, 1.5s linear).
- `@media (prefers-reduced-motion: reduce)` disables all animation and transition.

### Interaction states
- Hover: `background: rgba(255,255,255,0.06–0.07)`, border → `rgba(255,255,255,0.20)`. Semantic buttons hover into their own tint (lime/amber/red at ~0.12–0.20).
- Press: `transform: scale(0.98)` (0.94 on icon buttons).
- Window dots tint `#FF5F57 / #FEBC2E / #28C840` on hover.
- **No persistent glow.** Use `:focus-visible` for keyboard focus (2px lime outline, 2px offset) — never a sticky ring after mouse clicks.
- No chevrons on composer controls; the label *is* the affordance. Chevrons only in list-drill contexts (`›` on Connectors).

---

## 4. The composer (single model control)

Two rows, one border:

```
┌───────────────────────────────────────────────────────────────┐
│  Message Wren, or describe a mission…                    [▣]  │   ← 50px field, in-field stop/send
└───────────────────────────────────────────────────────────────┘
  Ask   +                      ● Codex CLI / gpt-5-codex   High  🦗
```

- **In-field button:** stop (square) while running; `↑` send otherwise.
- **Ask** → mode menu: Ask (1) · Accept edits (2) · Plan first (3) · Automatic (4). Each row = name + one-line consequence + check on active.
- **`+`** → Add files or photos · Slash commands · Connectors (`1 needs reconnection ›`).
- **Route control** → runtime + model, grouped by source: `Codex CLI · your account`, `Claude Code · your account`, `OmniRoute · API key`, `Local · Ollama`. Status tags: `ACTIVE / READY / PREVIEW / UNAVAILABLE / SIGN IN / API / LOCAL`. Rows carry discovery-derived detail (limit used, effort support, egress). Footer: live run status + "Fallback chain, privacy and permissions live in Settings".
- **Effort** → Fast (`fast` tag where the route reports it) · Balanced · High · Max, with a truthful footer about which routes honor effort.
- **Swarm mode (locust mark)** → workspace-wide; sets every teammate to its model's max effort, shows a persistent `SWARM · all teammates at max effort` chip in the title bar. Also toggleable in Settings. Open decisions: quota warning before engaging; whether it survives restart.
- Fallback chains, provider config, privacy and permission *policy* stay in Settings. Only runtime + model + effort + mode are on the main surface.

---

## 5. State system

Each state below is a designed thread composition, not a modal. `Locust Desktop.dc.html` renders all of them.

| State | Composition | Copy rules |
| --- | --- | --- |
| **First launch, no runtime** | Full logo, one-line trust promise, detected-runtime list (Use / Sign in / Configure), footer "no model is shown as live until it answers" | Never imply pooled access |
| **Detected accounts** | Codex row lime-tinted (`LIVE`), Claude `sign-in required`, local/API dashed and optional | Show version + route source |
| **Idle teammate** | 56px avatar, capability sentence, 3 starter missions | Lead with what they're good at |
| **Mission planning** | Plan card: step list with done / running / needs-approval markers, "2 of 4 done" | Name which step needs approval and why |
| **Live streaming** | Collapsed activity card (`Edited 6 files · ran 2 commands`, expandable to file/shell rows) + live step card with indeterminate bar + streaming text with caret | Logs never dump into the thread |
| **Teammate question** | Blue-headed card, question, 2 concrete options with consequences, "answer in the composer" note | State that work is paused and nothing changed |
| **Approval (consequential)** | Amber-headed card + 4-field grid: TARGET (app/account/identity), DATA SENT, REVERSIBLE, SCOPE (exact call) + Approve once / Always allow / Deny | Requester shown as `Wren · Codex CLI` |
| **Peer update** | Collapsed line `2 messages with 🟦 Atlas`; expands to the exchange with `UNTRUSTED` tag and "claims, never verified facts" | Peer content is never rendered as fact |
| **Model/runtime handoff** | Centered mono divider: `HANDOFF · Codex / gpt-5-codex → Claude Code / Sonnet 4.5 · checkpoint ck_12` | Always name the checkpoint |
| **Artifact** | Row: name, kind/size/path, Open | Path is real, mono |
| **Usage limit** | Red-headed card, reset time, `paused at checkpoint ck_14`, fallback options (other account route / local / wait + auto-resume) | Say the policy in force (`Ask`) |
| **Cancellation** | KEPT / STOPPED / NOT DONE grid + Resume from ck_14 / Keep changes, end / Revert to ck_12 | "You stopped this run at 14:47" |
| **Ledger (persistence) failure** | Red card, exact path + OS reason, SAFE vs AT RISK, Retry / Change location / End mission | Run is *held*, never continued silently without receipts |
| **Restored — interrupted** | Amber banner (Resume from checkpoint / View receipt) + receipt card: runtime, checkpoints, unverified steps, approvals, ledger path `verified` | Distinguish written vs unverified work |
| **Restored — completed** | Same receipt card with a `COMPLETED` tag, no banner | |
| **Runtime unavailable / auth required** | Sidebar teammate shows `Runtime sign-in required` (red); route row shows `SIGN IN` / `UNAVAILABLE` | Never silently reroute |

**Sidebar status vocabulary:** working (lime pulse) · approval needed (amber + count badge) · idle (muted) · blocked/sign-in (red) · completed (blue dot in history) · interrupted (red dot + "(interrupted)").

---

## 6. Inspector (Signal Rail)

Normalized events, newest first, colored by class: `tool.*` lime/violet, `checkpoint.written` blue, `model.switch` violet, `approval.*` amber, `runtime.discovered` neutral. Each row: event name + mono timestamp/outcome. Below it: Tools & permissions summary (`allow / ask / deny` + scope) with the tool count, then "Raw event log" as the deeper level. Tabs: Activity · Details · Artifacts · Receipt.

---

## 7. Keyboard & accessibility

- `⌘K` palette · `⌘N` new mission (missions start by messaging a teammate or from the palette; the sidebar `+` creates a teammate) · `⌘I` inspector · `⌘M` route picker · `⇧⌘S` swarm · `⌘1–3` Missions/Teammates/Settings · `1–4` in the mode menu · `↑↓` + `⏎` in menus · `Esc` closes overlays · `⌘⌫` stop run · `⏎` approve / `Esc` deny while an approval is focused (do not render these as button glyphs — the palette and menus are where shortcuts are shown).
- Every menu is a real `role="menu"` / `role="dialog"` with an `aria-label`; toggles carry `aria-pressed`; the route control is `aria-haspopup="listbox"`.
- Every clickable row (teammate, mission, settings sub-nav, filter chip, roster card, inspector tab) must be keyboard reachable and activate on `Enter`/`Space`. In the reference they carry `role="button"` + `tabindex="0"`; in React prefer real `<button>` elements with phrasing-content children, falling back to the role/tabindex pattern only where the row must contain block layout.
- Menu selections are real state: the composer's mode and effort labels read from the selected value, and the check mark follows it. Never hard-code the active row.
- Focus: `:focus-visible` only, 2px lime outline at 2px offset. Full tab order: sidebar → header → thread interactive items → composer controls → inspector.
- Contrast: **`#8B9190` is the dimmest color allowed on any in-app text**, at any size — labels, menu group headers, section captions, placeholders, mono provenance, metadata (5.5:1 on `#17191A`, ≥4.9:1 on `#191C1D`/`#1B1E1F`/`#16191A`). `#7A807F` is for non-text decoration only; `#616666` and `#4E5353` never appear inside the app window (documentation annotations only). Every in-app string measured at ≥4.5:1 against its composited background — verify with a ratio check, not by eye, and re-check after any surface change.
- Decorative avatar chips are `aria-hidden`; teammate identity is conveyed by adjacent text.

---

## 8. Responsive behavior

- **1480×940** — full three-region layout; inspector opens as an overlay-free right panel.
- **1120×720** (see the Compact exhibit in the reference) — sidebar collapses to a **64px avatar rail** (mark, `+`, teammate avatars with presence dots, settings), inspector closes and is reachable from the header "Activity" button, workroom keeps full width, composer keeps both rows. Never compress the workroom to keep the inspector open.
- Thread content column caps at 760px (700px compact) and centers.

---

## 9. Implementation requirements (unchanged from the brief)

- Keep Electron + React + TypeScript; preserve main-process, preload, IPC, sandbox, mission-ledger and runtime-safety invariants. Do not weaken security to simplify UI.
- Renderer-owned changes preferred; reusable components per §2.
- Bind to **real** runtime discovery, mission state, cancellation, and restored receipts. Sample teammates may exist only as clearly separated dev fixtures and must never appear as live missions or connected services.
- Codex / Claude / OmniRoute must be labeled by *current* implementation status (`LIVE` / `PREVIEW` / `API` / `LOCAL` / `SIGN IN` / `UNAVAILABLE`) derived from discovery, not constants.
- Effort and swarm must degrade honestly: if a route doesn't report effort support, show it as unsupported rather than sending a silent no-op.
- Preserve durable restored/interrupted behavior and the ledger-failure hold.

## 10. Known gaps / decisions for the implementer

1. **Teammate creation** is designed as a dialog (sidebar `+` or the roster's "New teammate" card): name field, avatar hue picker with live pixel-face preview, role grid (Code & Migrations · Research & Briefs · Ops & Scheduling · Docs & QA · Data & Reporting · Custom…), default route and approval mode summary, "tools follow the role, narrow them in Settings → Permissions". Still to decide: what "Custom…" collects (free-text role → tool inference?), whether the pixel face is chosen or generated from a name seed, and how tool grants are edited at creation vs. later.
2. **Swarm scope details:** quota warning before engaging, persistence across restart, per-mission override. The Settings toggle and the composer locust mark are two views of one workspace value — bind both to the same state (the reference does).
3. **Connections detail screen** (per-service auth, scopes, which teammates may use it) is referenced but not drawn.
4. **Missions screen** row actions (open receipt, resume, delete with retention rules) need definition.
5. Settings sub-pages beyond Runtimes/Fallback/Privacy are listed in the sub-nav but only those three are specified.
6. **Cloud computer** must stay visibly `PLANNED` and non-interactive until real.
