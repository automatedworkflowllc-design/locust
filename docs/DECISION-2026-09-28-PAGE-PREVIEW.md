# Decision, 2026-09-28: a web page a teammate made runs inside Locust

## What was decided

Colin, deciding fresh-eyes finding f045 ("No way to see a web page a teammate
made"):

> "at the end of the day we want our app to be usable and fulfilling, we don't
> want users to have to leave our app to see their html only to ask themselves
> why they even used us in the first place. Full functionality, sacrifice
> nothing."

So an `.html` file in the folder opens **running**: in the viewer beside the
conversation (Page / Source), and as a live preview on the card of a turn
that made it. Its scripts run, its CSS and images load from its folder, and
it may load what it links to on the web, as it would in a browser.

## What this changes

`DECISION-2026-09-20-LOCUST-NEVER-RUNS-MODEL-CODE.md` said Locust never runs
code a model wrote. That still holds for everything else -- the host executes
nothing, and images are still drawn only as rasters -- with this one, chosen
exception: a web page the person opens runs, in a place built for it.

## How it is contained (main/page-preview.ts)

- **Its own origin.** The page is served at `locust-page://<token>/<path>`,
  never at the app's origin, so it cannot read or script the window it sits
  in. The frame keeps `allow-same-origin` only so the page has its OWN
  storage; it has no `allow-top-navigation`.
- **No bridge.** A sub-frame gets no preload, so there is no `window.desktop`;
  and the host answers IPC from the top frame only (`fromOwnWindow`).
- **Only its folder.** Files are served from inside the folder the teammates
  work in, checked on the real path, so `../` and links or junctions that
  point outside it are refused (tested). A token is random per folder and per
  launch.
- **No devices.** The session still refuses every permission (camera,
  microphone, location, notifications).
- **The network, for the page only.** Packaged Locust still cancels every web
  request its own window makes; requests from a page frame, or from anything
  the page embedded, are allowed (`fromPagePreview`). Settings > Privacy says
  so.
- **Links out** that a page opens in a new window go to the person's browser.
