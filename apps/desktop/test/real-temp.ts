/*
 * Tests make their folders under os.tmpdir(). A hosted Windows runner hands
 * TEMP out as a short name (`C:\Users\RUNNER~1\...` for `runneradmin`) while
 * git prints the real one, and on the first public CI run (10/04) 31 tests
 * compared the two and failed. This runs before each test file and puts the
 * real spelling in TEMP once, so the tests see what a person's machine gives
 * them. The product's own tolerance of a short-named folder has its own test
 * (a-folder-given-by-its-short-name-is-still-the-root.test.ts).
 */
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

try {
  const real = realpathSync.native(tmpdir())
  process.env.TEMP = real
  process.env.TMP = real
  process.env.TMPDIR = real
} catch {
  // No temp folder to resolve: the tests that need one say so themselves.
}
