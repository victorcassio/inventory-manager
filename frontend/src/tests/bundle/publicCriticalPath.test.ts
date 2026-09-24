import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

const SRC = resolve(__dirname, '../..')

/**
 * Static `import ... from 'x'` / `export ... from 'x'` / `import 'x'` only.
 *
 * A dynamic import() is deliberately NOT followed: being behind one is exactly
 * what makes a route lazy, and following it would make this test assert the
 * opposite of what it is for.
 */
function staticImports(file: string): string[] {
  const source = readFileSync(file, 'utf-8')
  // The clause may span lines — `import {\n  A,\n  B,\n} from 'x'` is the
  // dominant style in this codebase, and both recharts importers use it. A
  // pattern anchored with [^'"\n] silently skipped them, so this test passed
  // while the dependency was reachable. Excluding ; and quotes keeps the
  // match from running past the end of one statement into the next.
  const pattern =
    /(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  const found: string[] = []
  for (const match of source.matchAll(pattern)) found.push(match[1] ?? match[2])
  return found
}

function resolveLocal(specifier: string, importer: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier)
  else return null

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }

  // Never silently. A local specifier that does not resolve means the walk
  // stops there, and everything behind it becomes invisible — every
  // "does not reach recharts" assertion would then pass for the wrong reason.
  throw new Error(`Cannot resolve ${specifier} from ${importer}`)
}

/** Every bare package statically reachable from an entry module. */
function reachablePackages(entry: string): Set<string> {
  const packages = new Set<string>()
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const specifier of staticImports(file)) {
      const local = resolveLocal(specifier, file)
      if (local) queue.push(local)
      else packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
    }
  }
  return packages
}

describe('the public critical path', () => {
  const entry = resolve(SRC, 'app/routes.tsx')

  it('does not statically reach recharts from the router entry', () => {
    // recharts is 400 kB and belongs to the dashboard, behind a lazy route. A
    // static import anywhere in this graph puts it in front of /login and the
    // three public password pages — which is how it reached the critical path
    // once already, by way of clsx being swallowed into its chunk.
    expect([...reachablePackages(entry)]).not.toContain('recharts')
  })

  it.each([
    'features/auth/pages/ActivateAccountPage.tsx',
    'features/auth/pages/ForgotPasswordPage.tsx',
    'features/auth/pages/ResetPasswordPage.tsx',
    'pages/LoginPage.tsx',
  ])('does not statically reach recharts from %s', (page) => {
    expect([...reachablePackages(resolve(SRC, page))]).not.toContain('recharts')
  })

  it('keeps the dashboard behind a lazy import', () => {
    const routes = readFileSync(entry, 'utf-8')

    expect(routes).toMatch(/const DashboardPage = lazy\(/)
    expect(routes).not.toMatch(/^import \{ DashboardPage \}/m)
  })

  it.each([
    'features/dashboard/components/RevenueBarChart.tsx',
    'features/dashboard/components/CumulativeLineChart.tsx',
  ])('sees the multi-line import clause in %s', (page) => {
    // Guards the assertions above: with a single-line-only pattern this walk
    // could not see these two chart components at all, and every "does not
    // reach" assertion was an under-approximation that passed for the wrong
    // reason. (The third importer, RentalStatusPieChart, is single-line.)
    const chart = resolve(SRC, page)

    expect(readFileSync(chart, 'utf-8')).toMatch(/import \{\n/)
    expect(staticImports(chart)).toContain('recharts')
  })

  it('sees the single-line importer too', () => {
    const chart = resolve(SRC, 'features/dashboard/components/RentalStatusPieChart.tsx')
    expect(staticImports(chart)).toContain('recharts')
  })

  it('does reach recharts from the dashboard page itself', () => {
    // The inverse check. Without it, the assertions above would keep passing
    // if recharts were simply removed from the project, and would stop meaning
    // what they claim.
    expect([...reachablePackages(resolve(SRC, 'pages/DashboardPage.tsx'))]).toContain('recharts')
  })
})
