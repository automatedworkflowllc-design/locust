// Bundles the sample page to a single file so it opens from disk with no
// server: the point is a PICTURE, and a dev server is one more thing to fail.
import { build } from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js'

await build({
  entryPoints: [new URL('./main.jsx', import.meta.url).pathname.slice(1)],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  outfile: new URL('./bundle.js', import.meta.url).pathname.slice(1),
  // pnpm puts react and thinking-orbs under the app that depends on them,
  // not at the root, so resolution has to be told where to look.
  nodePaths: [new URL('../../apps/desktop/node_modules', import.meta.url).pathname.slice(1)],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info'
})
