# Orb samples

    node _tools/orb-samples/build.mjs      # bundle (esbuild, single file)
    node _tools/orb-samples/serve.mjs      # http://127.0.0.1:5199/

A page that renders every orb the library ships, at the size that ships and at
the 64 asset painted into bigger boxes, with the row's own word beside each so
a size is judged the way it will be seen.

**It exists because a size question cannot be answered in prose.** Colin asked
for one orb slightly larger; it was done with a CSS transform on the 20px
preset and his verdict was *"you just cooked the resolution"* — correct, that
enlarges a 20px raster. The library also ships a **64** preset, which is a
different drawing with more of everything, so a bigger orb is a 64 painted
into a smaller-than-64 box: a downscale, which stays sharp.

The page is built rather than served by vite on purpose: vite would not start
from this workspace root, and the browser tool cannot open `file://`, so it is
one esbuild bundle and a twenty-line static server.

**Do not ship a size from this page without showing it to Colin.** His rule,
2026-09-20: *"maybe send me samples before shipping"*.
