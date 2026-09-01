# Locust desktop shell — design reference

Received 2026-08-31 as the redesigned primary shell.

- **`HANDOFF.md`** — the spec: tokens, states, components, accessibility, gaps.
- **`Locust Desktop.dc.html`** — interactive visual reference. Serve the folder
  (`python -m http.server`) and open it; the strip above the window switches all
  ten states and three screens. `support.js` is its runtime; both are reference
  material, not product code.
- Brand SVGs in the drop were byte-identical to `/brand` and are not duplicated.

The integration plan that maps every designed surface to real state lives at
`docs/UI-INTEGRATION-PLAN.md`. Read the plan before lifting anything from the
reference: the reference's values are illustrative by declaration, and some of
its states require capabilities the product does not have yet.
