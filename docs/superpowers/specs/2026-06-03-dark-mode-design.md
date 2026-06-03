# Dark Mode — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming complete)
**Scope:** Frontend only (`frontend/`). Backend untouched.

## Goal

Add an app-wide dark mode with a sun/moon icon toggle in the header. On first
load the app follows the user's OS preference; once the user toggles, their
explicit choice wins and persists across sessions.

## Context

The frontend is a React 18 + Vite + TypeScript + Tailwind 3.4 app using a
shadcn/ui-style token system. Dark mode is already ~70% wired:

- `tailwind.config.js` has `darkMode: ['class']` — flipping a `.dark` class on
  `<html>` switches themes.
- The UI consumes semantic CSS-variable tokens (`bg-background`,
  `text-foreground`, `border-border`, `bg-card`, `bg-popover`, …).
- Many status colors already ship `dark:` variants
  (e.g. `bg-green-50 dark:bg-green-950`).
- `auth.store.ts` is a clean `zustand` + `persist` reference pattern.

What is missing: a `.dark {}` variable block, a theme store, the header toggle,
flash-prevention on load, and a few small fixes.

## Decisions (from brainstorming)

- **Default on first load:** match OS via `prefers-color-scheme`. Explicit
  toggle choice overrides and persists.
- **Audit scope:** core surface + obvious gaps only. Nail the structural
  palette and fix status colors that are clearly unreadable in dark
  (financial / overdue / success / warning / error badges & labels). No full
  screen-by-screen audit — deeper status-color polish is a separate follow-up.
- **Toggle UI:** a `ghost` icon button (sun/moon), not a sliding switch.
  Consistent with the existing header menu button. Placed immediately before
  "Olá, {user}".
- **Palette:** "Elevated Slate" — cards/popovers sit a shade above the
  background for visual depth between surfaces.

## Component 1 — Dark palette (`src/index.css`)

Add a `.dark { … }` block under the existing `:root` block, defining the dark
value for every existing token. No other styling changes are needed; because
the app already reads these tokens, defining them turns on dark mode app-wide.

| Token | Light (current) | Dark (Elevated Slate) |
|---|---|---|
| `--background` | `0 0% 100%` | `222 47% 11%` |
| `--foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--card` | `0 0% 100%` | `222 41% 15%` |
| `--card-foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--popover` | `0 0% 100%` | `222 41% 15%` |
| `--popover-foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--primary` | `221.2 83.2% 53.3%` | `217.2 91.2% 59.8%` |
| `--primary-foreground` | `210 40% 98%` | `222.2 47.4% 11.2%` |
| `--secondary` | `210 40% 96.1%` | `217 33% 20%` |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` |
| `--muted` | `210 40% 96.1%` | `217 33% 20%` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `215 20% 68%` |
| `--accent` | `210 40% 96.1%` | `217 33% 22%` |
| `--accent-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` |
| `--destructive` | `0 84.2% 60.2%` | `0 62% 45%` |
| `--destructive-foreground` | `210 40% 98%` | `210 40% 98%` |
| `--border` | `214.3 31.8% 91.4%` | `217 33% 24%` |
| `--input` | `214.3 31.8% 91.4%` | `217 33% 24%` |
| `--ring` | `221.2 83.2% 53.3%` | `217.2 91.2% 59.8%` |

`--radius` is unchanged. The primary blue is brightened from 53.3% → 59.8%
lightness so it stays legible against the dark base (saturated mid-blue is too
dim on dark). Card/popover at `15%` sit above the `11%` background for the
"elevated" depth.

## Component 2 — Theme store (`src/stores/theme.store.ts`)

A `zustand` + `persist` store mirroring `auth.store.ts`.

- **State:** `theme: 'light' | 'dark' | 'system'`.
- **Actions:** `setTheme(theme)`, `toggleTheme()` (flips between explicit
  `light`/`dark` based on the currently *resolved* theme).
- **Persistence:** `localStorage`, key `inventory-theme`, persisting only
  `theme`.
- **`applyTheme()` helper:** resolves the active theme (`system` →
  `matchMedia('(prefers-color-scheme: dark)').matches`) and toggles the `.dark`
  class on `document.documentElement`. Called on store init/rehydrate and after
  every change.
- **OS sync:** a `matchMedia` change listener re-applies the theme while the
  store value is `system`, so live OS changes are reflected.

**What it does:** owns theme state and keeps the `.dark` class in sync.
**How it's used:** `useThemeStore()` in the header; `applyTheme()` at startup.
**Depends on:** `zustand`, browser `localStorage` + `matchMedia`.

## Component 3 — Flash prevention (`index.html`)

A tiny inline `<script>` in `<head>`, before the app bundle, that reads
`localStorage` (`inventory-theme`), resolves `system` via `matchMedia`, and adds
the `.dark` class to `<html>` before first paint. This prevents a white flash
for dark-mode users on load. The React store re-syncs on mount (idempotent).

## Component 4 — Header toggle (`src/components/layout/Header.tsx`)

A `ghost` `size="icon"` `Button` (same as the existing menu button), placed
immediately before the "Olá, {user}" span.

- Icon: `Sun` when the resolved theme is dark (action = go light), `Moon` when
  resolved theme is light (action = go dark). Both from `lucide-react`.
- Accessibility: both `aria-label` and `title` describe the action —
  "Switch to dark mode" / "Switch to light mode" — plus `sr-only` text,
  consistent with the existing menu button. Label and icon both update with the
  active theme.
- `onClick` → `toggleTheme()`.

## Component 5 — Small fixes ("obvious gaps")

- `src/components/ui/select.tsx`: hardcoded `bg-white` on the dropdown content
  → `bg-popover` (otherwise dropdowns render white in dark mode).
- Status colors: add missing `dark:` variants **only** where readability
  clearly breaks in dark — financial / overdue / success / warning / error text
  and badges (e.g. add `dark:text-green-400` next to `text-green-600`,
  `dark:text-red-400` next to `text-red-600`, etc.). No exhaustive audit.
- Overlay colors (`bg-black/80`, `bg-black/40` on dialog/sidebar overlays) are
  intentional in both themes and left as-is.

## Data flow

```
OS preference ─┐
               ├─► applyTheme() ─► toggles `.dark` on <html> ─► CSS vars switch ─► app repaints
localStorage ──┘            ▲
                            │
Header toggle ─► toggleTheme() ─► setTheme(explicit) ─► persist + applyTheme()
```

## Error handling

- `localStorage` access wrapped defensively (private-mode / disabled storage):
  on failure, fall back to `system` resolution in memory; never throw on load.
- `matchMedia` guarded for environments where it is undefined (test/SSR-like):
  treat as light when unavailable.

## Testing

- `src/tests/stores/theme.store.test.ts`:
  - `toggleTheme` / `setTheme` update state and toggle the `.dark` class.
  - `system` resolves correctly via a mocked `matchMedia` (both matches states).
  - Persistence round-trips through `localStorage`.
- `src/tests/layout/Header.test.tsx` (extend existing):
  - Toggle button renders with an accessible label/title.
  - Correct icon shown per active theme.
  - Clicking flips the theme and updates the label/icon.
- Full existing suite must stay green.

## File summary

**New:** `src/stores/theme.store.ts`, `src/tests/stores/theme.store.test.ts`.
**Edited:** `src/index.css` (dark block), `index.html` (flash script),
`src/components/layout/Header.tsx` (+ its test), `src/components/ui/select.tsx`,
and a handful of status-color lines across feature components.
**Untouched:** backend.

## Out of scope (follow-up)

- Full screen-by-screen status-color audit and polish.
- Per-chart (Recharts) dark theming beyond what the token swap already covers.
- A three-way (light / dark / system) UI selector — the toggle is binary;
  `system` is the implicit pre-toggle default only.
