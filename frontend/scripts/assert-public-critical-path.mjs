#!/usr/bin/env node
/**
 * Fails the build if a heavy feature chunk re-enters the critical path that
 * every public page pays for — /login, /activate-account, /forgot-password,
 * /reset-password.
 *
 * This is not a size budget. It walks each entry's transitive import graph in
 * the build manifest and asserts certain chunks are absent from it, so it fails
 * for the reason that matters: the chunk became a static dependency of an
 * entry, not that it grew. The byte ceiling below is only a backstop for the
 * case where a chunk is renamed or dissolved rather than removed from the graph.
 *
 * How the last regression happened, for whoever trips this. `manualChunks` in
 * object form gives you no control over a listed package's transitive
 * dependencies — they go to whichever listed root Rollup executes first.
 * recharts depends on clsx, clsx is also imported by cn() in src/lib/utils.ts,
 * so the entry ended up statically importing a module that lived inside the
 * 400 kB charts chunk. Nothing in the source looked wrong. The config now uses
 * the function form and claims shared leaves explicitly; the fix is always to
 * find what joined the entry graph, never to delete the preload tag.
 *
 * Matching is on the chunk name the manifest records, never on a hashed
 * filename, so it survives rebuilds.
 */
import { readFileSync, rmSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN = ['charts-vendor', 'calendar-vendor']

/**
 * A ceiling on one entry's critical path, in gzipped bytes.
 *
 * The name list above is the precise check; this catches the same regression
 * arriving under a different name. It sits above the current ~145 kB so
 * ordinary growth does not trip it, and below what either forbidden chunk
 * would cost (charts ~115 kB, calendar ~61 kB). If it ever fires on growth
 * rather than on a returning chunk, that is a signal to move something off the
 * path — not to raise the number.
 */
const MAX_CRITICAL_PATH_GZIP = 200 * 1024

const manifestDir = resolve(root, 'dist/.vite')

let manifest
try {
  manifest = JSON.parse(readFileSync(join(manifestDir, 'manifest.json'), 'utf-8'))
} catch {
  console.error(
    '[critical-path] dist/.vite/manifest.json not found. Run `npm run build` — this\n' +
      'script consumes and deletes the manifest, so it cannot run twice against one\n' +
      'build. It is emitted by build.manifest in vite.config.ts, not by a CLI flag.',
  )
  process.exit(1)
}

// Read, then remove. The manifest maps every source file to its chunk, which is
// build metadata rather than something the app serves. Nothing else consumes it.
rmSync(manifestDir, { recursive: true, force: true })

const entryKeys = Object.keys(manifest).filter((key) => manifest[key].isEntry)
if (entryKeys.length === 0) {
  console.error('[critical-path] no entry found in the manifest.')
  process.exit(1)
}

/**
 * Everything the browser must fetch before this entry can render.
 * dynamicImports are deliberately not followed — being behind one is what makes
 * a route lazy.
 */
function criticalFor(entryKey) {
  const reached = new Set()
  const walk = (key) => {
    if (!manifest[key] || reached.has(key)) return
    reached.add(key)
    for (const imported of manifest[key].imports ?? []) walk(imported)
  }
  walk(entryKey)
  return reached
}

function gzipBytes(chunk) {
  let total = 0
  for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
    if (!file) continue
    const path = resolve(root, 'dist', file)
    try {
      if (statSync(path).isFile()) total += gzipSync(readFileSync(path), { level: 9 }).length
    } catch {
      /* a file the manifest names but the build did not emit */
    }
  }
  return total
}

let failed = false

// Judged per entry: summing a union across entries would measure a combined
// inventory that nobody actually downloads.
for (const entryKey of entryKeys) {
  const critical = criticalFor(entryKey)

  const offenders = []
  for (const key of critical) {
    const chunk = manifest[key]
    const chunkName = chunk.name ?? chunk.file ?? ''
    for (const name of FORBIDDEN) {
      if (chunkName === name || (chunk.file ?? '').includes(name)) {
        offenders.push({ name, file: chunk.file })
      }
    }
  }

  // Named offenders first. The byte ceiling would fire on this same regression
  // and say only that the path got bigger, losing the actionable part.
  if (offenders.length > 0) {
    failed = true
    console.error(`\n[critical-path] FAIL (${entryKey}) — a feature chunk is on the critical path:\n`)
    for (const { name, file } of offenders) console.error(`  ${name}  ->  ${file}`)
    console.error(
      '\nEvery public page now downloads it. Find which module of that chunk the\n' +
        'entry imports — a shared transitive dependency is the usual cause — and\n' +
        'claim it in an earlier rule in manualChunks. Do not delete the preload tag.\n',
    )
    continue
  }

  const criticalBytes = [...critical].reduce((sum, key) => sum + gzipBytes(manifest[key]), 0)

  if (criticalBytes > MAX_CRITICAL_PATH_GZIP) {
    failed = true
    console.error(
      `\n[critical-path] FAIL (${entryKey}) — ${(criticalBytes / 1024).toFixed(1)} kB gzip on the ` +
        `critical path, over the ${(MAX_CRITICAL_PATH_GZIP / 1024).toFixed(0)} kB ceiling.\n\n` +
        'This is the backstop for a chunk renamed or dissolved rather than removed\n' +
        'from the graph. Every public page pays it before rendering, including the\n' +
        'password pages opened from an e-mail link on a phone. Find what joined the\n' +
        'entry graph rather than raising the ceiling.\n',
    )
    continue
  }

  console.log(
    `[critical-path] OK (${entryKey}) — ${critical.size} chunks, ` +
      `${(criticalBytes / 1024).toFixed(1)} kB gzip, none of: ${FORBIDDEN.join(', ')}`,
  )
}

if (failed) process.exit(1)
