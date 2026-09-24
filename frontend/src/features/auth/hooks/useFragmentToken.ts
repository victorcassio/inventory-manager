import { useLayoutEffect, useState } from 'react'

/**
 * Shape of a token the backend can actually have issued: randomBytes().
 * toString('base64url'), i.e. base64url's alphabet and nothing else.
 *
 * Anything else is junk — a truncated copy-paste, a mangled e-mail client, a
 * probe — and is treated as no token at all, so the page renders its
 * invalid-link state instead of spending a request to be told the same thing.
 */
// The backend issues randomBytes(32).toString('base64url') — 43 characters —
// and its DTOs cap the field at 200. The bound is loose enough to survive a
// change of TOKEN_BYTES and tight enough that an over-long value never becomes
// a request that the server would answer with a length-validation message the
// user cannot act on.
const BASE64URL = /^[A-Za-z0-9_-]{16,200}$/

/**
 * Reads a single-use token out of the URL fragment, once, and then removes the
 * fragment.
 *
 * The fragment carries the token instead of the query string because browsers
 * never send it to a server: it cannot reach an access log, a Referer header or
 * a proxy. That property is only worth having if the value stays put, so the
 * token lives exactly here — in component state for the life of the mount, and
 * nowhere else. Not the auth store, not localStorage or sessionStorage, not a
 * TanStack Query key, not a log line.
 *
 * Consequence, by design: once the fragment is stripped, refreshing the page
 * loses the token for good. The page must then show its invalid-link state
 * rather than call the API.
 *
 * Known residue, not fixable here: replaceState rewrites the current session
 * entry, not the browser's persistent history database, which recorded the full
 * URL at navigation time and may sync it to the user's other devices. What
 * bounds that is the token being single-use and short-lived, not this hook.
 *
 * Note for callers: the rewrite goes around react-router, which only refreshes
 * its own `location` on its navigations and on popstate. So `useLocation().hash`
 * keeps reporting the token-bearing fragment after this hook has removed it —
 * do not feed `useLocation()` back into a `<Navigate to={location}>` or
 * `navigate(location)` on a page that uses this hook, or the token goes
 * straight back into the URL.
 */
export function useFragmentToken(): string | null {
  // Lazy and PURE. React may call this initializer more than once — StrictMode
  // does exactly that — so it must only read. The URL is rewritten in the
  // effect below, never here.
  const [token] = useState<string | null>(() => readTokenFromHash(window.location.hash))

  useLayoutEffect(() => {
    // Only a fragment that carries a token is ours to remove. Stripping any
    // fragment would silently destroy a legitimate in-page anchor on whatever
    // page this hook is dropped onto. Note this is deliberately about the
    // PRESENCE of the parameter, not its validity: a malformed token still has
    // to leave the URL.
    if (!hashCarriesToken(window.location.hash)) return

    window.history.replaceState(
      // Keep the existing entry's state — react-router keeps its own bookkeeping
      // there, and passing null would strip it.
      window.history.state,
      document.title,
      // Path and query survive; only the fragment goes. The query may carry
      // legitimate state and is not the secret here.
      `${window.location.pathname}${window.location.search}`,
    )
  }, [])

  return token
}

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}

function hashCarriesToken(hash: string): boolean {
  return hash.length > 0 && hashParams(hash).has('token')
}

function readTokenFromHash(hash: string): string | null {
  const all = hashParams(hash).getAll('token')

  // Exactly one, non-empty, and shaped like a token the backend issues.
  // Two values means a crafted or mangled link, and picking either would be a
  // guess.
  if (all.length !== 1) return null

  const token = all[0]
  if (token && BASE64URL.test(token)) return token

  if (import.meta.env.DEV) {
    // Never the value. Without this, a mail client mangling links or a change
    // of token encoding looks exactly like an expired link to every user and
    // to whoever is debugging it.
    console.warn('[useFragmentToken] fragment token rejected on shape')
  }
  return null
}
