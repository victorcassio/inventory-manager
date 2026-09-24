import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Always emitted: scripts/assert-public-critical-path.mjs reads it to keep
    // heavy feature chunks off the path every public page pays for.
    manifest: true,
    rollupOptions: {
      output: {
        // Splitting vendors costs ~4 kB gzip on a cold first load versus letting
        // Vite emit one entry chunk; what it buys is that react, zod, axios and
        // friends keep their hashes across deploys instead of being re-fetched
        // with every application change. That is the trade being made here.
        //
        // Function form, not the object form.
        //
        // The object form does NOT let you order anything: Rollup sorts the
        // listed roots by module execIndex, not by key order, and then pre-seeds
        // every explicitly listed root before traversal. What it hands you is
        // control over the roots you name, and nothing at all over their
        // transitive dependencies — those go to whichever listed root Rollup
        // happens to execute first. That is how a 400 kB charts chunk ended up
        // on the critical path of every page: recharts depends on clsx, clsx is
        // also imported by cn() in src/lib/utils.ts, and the entry therefore
        // statically imported a module living inside charts-vendor.
        //
        // It is also why `'react-vendor': ['react']` did not actually put React
        // in react-vendor: for a CommonJS package the listed name resolves to
        // @rollup/plugin-commonjs's synthetic entry proxy, so the real modules
        // were never pre-seeded and @tanstack/react-query claimed them.
        //
        // Matching on the resolved id is immune to both problems, and the rule
        // order below is real precedence rather than a comforting fiction.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const pkg = (name: string) => id.includes(`/node_modules/${name}/`)

          // Shared leaves FIRST. These are tiny, and they are imported both by
          // the entry graph and by a heavy feature chunk — whoever claims them
          // decides whether that heavy chunk joins the critical path. Entry
          // criterion for this bucket: small, and shared across that boundary.
          // Not a parking spot for anything else.
          if (
            pkg('clsx') ||
            pkg('tailwind-merge') ||
            pkg('class-variance-authority') ||
            // zustand/traditional imports this, and src/stores/auth.store.ts is
            // on the public critical path. Left unclaimed it sits inside
            // charts-vendor, one import away from dragging it back.
            pkg('use-sync-external-store') ||
            pkg('react-is')
          ) {
            return 'ui-vendor'
          }

          if (
            pkg('react') ||
            pkg('react-dom') ||
            pkg('scheduler') ||
            pkg('react-router') ||
            pkg('react-router-dom') ||
            id.includes('/node_modules/@remix-run/')
          ) {
            return 'react-vendor'
          }

          if (id.includes('/node_modules/@tanstack/')) return 'query-vendor'

          if (pkg('react-hook-form') || pkg('zod') || id.includes('/node_modules/@hookform/')) {
            return 'form-vendor'
          }

          if (pkg('axios')) return 'http-vendor'

          if (
            pkg('recharts') ||
            pkg('victory-vendor') ||
            pkg('react-smooth') ||
            pkg('recharts-scale') ||
            id.includes('/node_modules/d3-')
          ) {
            return 'charts-vendor'
          }

          if (id.includes('/node_modules/@fullcalendar/') || pkg('preact')) return 'calendar-vendor'
          if (pkg('date-fns')) return 'date-vendor'

          return undefined
        },
      },
    },
  },
})
