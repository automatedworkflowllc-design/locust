// Put a runnable npm where the packager will actually carry it.
//
//   node _tools/vendor-npm.mjs
//
// Locust installs coding CLIs with npm, and a machine with no Node has none.
// The app's own binary is a Node runtime, so all that is missing is npm
// itself -- and npm is a program, not a folder: it needs the ~118 packages
// it bundles.
//
// Two ways failed before this existed, both measured:
//
//   asarUnpack: node_modules/npm/**   ->  npm arrived, its node_modules did
//     not. pnpm links node_modules/npm at its store and the link took the
//     folder without the tree under it.
//   extraResources from node_modules/npm  ->  same result: the packager
//     filters nested node_modules out of a copy.
//
// Both produced the same first run: "Cannot find module 'graceful-fs'". So
// npm is staged OUTSIDE node_modules, into `apps/desktop/resources/npm`,
// where it is an ordinary directory the packager copies whole.
//
// Run before packaging; `ship.mjs` does it.

import { cpSync, existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const DESTINATION = join(DESKTOP, 'resources', 'npm')

/** npm's real directory, with the link resolved. */
function npmRoot() {
  const require = createRequire(join(DESKTOP, 'package.json'))
  // `npm/package.json` rather than the CLI: the package root is what has to
  // be copied, and this resolves through the link pnpm made.
  return dirname(require.resolve('npm/package.json'))
}

const source = npmRoot()
const bundled = join(source, 'node_modules')
if (!existsSync(bundled)) {
  console.error(`npm at ${source} has no node_modules; it would not run. Install dependencies first.`)
  process.exit(1)
}

rmSync(DESTINATION, { recursive: true, force: true })
mkdirSync(dirname(DESTINATION), { recursive: true })
cpSync(source, DESTINATION, { recursive: true, dereference: true })

const version = JSON.parse(readFileSync(join(DESTINATION, 'package.json'), 'utf8')).version
const count = existsSync(join(DESTINATION, 'node_modules'))
  ? (await import('node:fs')).readdirSync(join(DESTINATION, 'node_modules')).length
  : 0
if (count === 0) {
  console.error('npm was staged without the packages it bundles; it would not run.')
  process.exit(1)
}
console.log(`Staged npm ${version} with ${String(count)} bundled packages at apps/desktop/resources/npm.`)
