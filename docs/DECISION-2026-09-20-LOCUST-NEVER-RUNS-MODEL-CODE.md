# Decision: Locust never runs code a model wrote

> **Amended 2026-09-28 — web pages run.** Colin, as the product's owner:
> "full functionality, sacrifice nothing." A web page a teammate made now
> opens running, inside Locust, in a frame of its own origin with no bridge
> to the app. See `DECISION-2026-09-28-PAGE-PREVIEW.md`. Everything else
> below still holds: the host executes nothing else a model wrote.

**The question** (`PLAN-2026-09-20-VIEWER-AND-ARTIFACTS.md`, item **b**):
*should Locust ever run code a model wrote, in any sandbox, on this machine?*

Colin delegated it, 2026-09-20: *"ill let you decide on b what is best for
user experience."*

**The answer is no, and the reason is a user-experience reason.** The security
argument is real and is not the strongest one.

---

## Why this is a UX decision before it is a security one

The goal for this app is a person with no technical background opening it and
getting somewhere — Colin's own words: *"i really want a new user without tech
savvyness beable to just use the software off rip."*

For that person, the most valuable property Locust has is that **it cannot
surprise them**. Everything a teammate produces is a file on their disk and a
sentence in a conversation. Nothing the app does is invisible. That is a
promise somebody can hold in their head in one sentence:

> Locust never runs what a teammate wrote. You do, if you want to.

A sandbox replaces that sentence with a different one: *"Locust runs what a
teammate wrote, but safely."* That is not a promise a non-technical person can
evaluate. It asks them to trust an implementation they cannot inspect, about a
risk they cannot picture, from an app they installed yesterday past a
SmartScreen warning that already said the publisher is unknown.

The first sentence is worth more than a preview pane.

## What it would cost, concretely

**The app already says the opposite, out loud.** 0.207.0 shipped a standing
line at the foot of the file panel:

> Locust does not open files — a teammate chose this file's name and contents.
> Reveal hands it to Windows.

A preview would make that line false, or force it into a caveat: *"except
HTML, which we run in a sandbox."* A rule with an exception is not a rule
somebody remembers.

**The refusals are load-bearing and consistent.** `shell.openPath` is refused
in `reveal-file.ts`; the renderer's CSP is `frame-src 'none'`, `object-src
'none'`, `script-src 'self'`; `decideReveal` keeps every path inside a folder
a mission ran in. A preview means reopening the CSP, adding a `<webview>` or
an iframe, and maintaining a second security boundary forever — in an app
whose whole point is running other people's agents.

**The threat is not hypothetical here, it is the premise.** Every file in the
workspace was written by a model, which chose both the name and the contents.
The app is a harness for running models that write files. "What if the file is
hostile" is not an edge case in Locust; it is the ordinary case.

## What the person actually wanted

Almost never "run this". Nearly always **"show me what my teammate made"** —
and that is a rendering question, which is safe, and which is mostly already
built:

- markdown renders as prose in the viewer (0.203.0)
- every file a turn touched opens from the activity fold (0.204.0)
- the turns that changed a file, and what each changed (0.206.0)
- a copy saved anywhere they like; reveal for "where is it"

**And one gap this decision pays for immediately: images.** A teammate that
writes a chart, a diagram or a screenshot produces a PNG, and the viewer
refused it — `isViewableText` says no and the panel says so. The plumbing to
draw it already existed for attachments (`image-files.ts`,
`readWorkspaceImage`), including the part that matters: **SVG is deliberately
not painted**, because an SVG is a document that can carry script. Raster
images execute nothing.

That is the artifact experience people are actually asking for, and it costs
none of the promise.

## What would change this

Not a better sandbox. **A user asking for it, repeatedly, for something the
rendering path cannot do** — and even then the shape is more likely "Locust
hands this to your browser, with one clear sentence about what that means",
which is the user's machine running the user's file at the user's request.
That is a different decision from Locust executing it silently, and it is the
one worth revisiting first.

Revisit if: people ask for live previews more than once; or Locust grows a
first-class notion of a document that is meant to be interactive. Until then
the answer stays no, everywhere, consistently — and the consistency is the
product.
