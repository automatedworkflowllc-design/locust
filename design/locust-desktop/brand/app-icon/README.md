# The app icon

The design agent'''s `v` candidate, "portrait, soft fade", picked by Colin on
2026-09-06 ("looks 10x better"). In its own words: the mark scaled so the
wings run edge to edge and the antennae break the top, thickened so it
survives 32px, and the abdomen faded out at the bottom so the crop ends in air
instead of a slab. Nothing was redrawn -- it is the same artwork as
`../locust-mark.svg`, composed rather than cropped with a rectangle.

These five sizes are what the agent supplied, from `icon-candidates/` in
"Locust desktop shell UI.zip". `_tools/render-icon.cjs` uses each as-is and
scales the 1024 for the sizes Windows wants that are not here (128, 48, 16),
then packs `apps/desktop/resources/icon.ico`. Do not re-render these from an
SVG: an earlier pipeline did, and shipped a differently-framed icon than the
one the designer drew.
