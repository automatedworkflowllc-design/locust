import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The npm this app carries, for a machine that has none.
 *
 * MEASURED 2026-09-17, reported by Ian: Locust did nothing until he installed
 * Node.js. Every coding CLI it offers installs with `npm install -g`, so with
 * no npm the first screen disabled its own Install buttons and sent him to
 * nodejs.org. The app that could not install anything was the app that had
 * just been downloaded to install something.
 *
 * It was never really missing. An Electron binary started with
 * `ELECTRON_RUN_AS_NODE=1` is a Node runtime -- 24.18.1 in the packaged
 * build -- and npm is a node script. Shipping npm beside the app and running
 * it with the app's own Node is measured working: installing a package into
 * a scratch prefix answered "added 2 packages in 1s" with no Node anywhere
 * on PATH.
 *
 * What this does NOT do is make those CLIs work in the person's own
 * terminal. npm writes launcher shims that call `node`, so outside Locust
 * they still need a Node; inside it, the locator resolves them through the
 * same runtime. That is worth saying on screen rather than being discovered.
 */

/** Where npm sits once electron-builder has unpacked it beside the asar. */
export function bundledNpmPaths(resourcesPath: string, appPath: string): readonly string[] {
  return [
    /*
     * Packaged: staged at `resources/npm` by `_tools/vendor-npm.mjs` (which
     * resolves pnpm's link to the store, so the copy is real files), then
     * carried through the asar and unpacked beside it.
     *
     * The route matters, and both wrong ones were measured. `asarUnpack` of
     * `node_modules/npm` packaged pnpm's LINK and left the 111 packages npm
     * bundles behind. `extraResources` of the resolved copy dropped
     * `node_modules` outright -- the packager filters that name out of a
     * plain directory copy, which also takes the 8 nested ones that carry
     * npm's version conflicts. Either way the first run with no Node said
     * "Cannot find module 'graceful-fs'": npm failing to be a program,
     * rather than Locust failing to find one. Through the asar all 119
     * directories arrive.
     */
    join(resourcesPath, 'app.asar.unpacked', 'resources', 'npm', 'bin', 'npm-cli.js'),
    // Development: the workspace's own copy.
    join(appPath, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(appPath, '..', '..', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ]
}

export interface BundledNpm {
  /** The Node to run it with: this process's own binary. */
  readonly nodePath: string
  readonly cliPath: string
  readonly env: Readonly<Record<string, string>>
}

/** The bundled npm, or nothing when this build did not ship one. */
export function findBundledNpm(input: {
  readonly resourcesPath: string
  readonly appPath: string
  readonly execPath: string
  readonly exists?: (path: string) => boolean
}): BundledNpm | undefined {
  const exists = input.exists ?? existsSync
  const cliPath = bundledNpmPaths(input.resourcesPath, input.appPath).find((candidate) => exists(candidate))
  if (cliPath === undefined) return undefined
  return {
    nodePath: input.execPath,
    cliPath,
    // Without this the same binary opens another copy of the app.
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}
