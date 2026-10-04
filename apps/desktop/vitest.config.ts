import { defineConfig } from 'vitest/config'

// Everything else is vitest's default: the per-file environment comments, the
// default test glob. The one setup file gives every test a TEMP in its real
// spelling (test/real-temp.ts says why).
export default defineConfig({
  test: {
    setupFiles: ['./test/real-temp.ts']
  }
})
