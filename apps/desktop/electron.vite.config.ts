import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: ['@teammate/runtime-adapters', '@teammate/mission-store']
    })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name]-[hash].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    /*
     * MINIFIED, which electron-vite 5 does not do for the renderer by default.
     *
     * The bundle shipped as written: 1.47 MB of JavaScript and 352 KB of CSS,
     * half of it comments, parsed by BOTH windows at every launch -- the
     * loading window and the app behind it -- while the runtime probes were
     * starting on the same cores (measured 2026-09-22: the probes ran ~0.2 s
     * slower once they overlapped the parse). `keepNames` keeps function
     * names in stack traces, so an error a person reports still says where.
     */
    build: {
      minify: 'esbuild',
      cssMinify: true,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          // The page that opens an attached PDF for the agent (0.713,
          // src/pdfReader.ts): its own entry, so pdf.js is never in the app's
          // bundle and the app never runs in the view that reads.
          pdf: resolve('src/renderer/pdf.html')
        }
      }
    },
    esbuild: {
      keepNames: true,
      // Licence notices kept in the bundle (0.713): a minified bundle dropped
      // every one, PDF.js's Apache notice among them.
      legalComments: 'inline'
    }
  }
})
