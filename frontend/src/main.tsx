import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Side-effect import: evaluating the store rehydrates the saved theme and
// registers the OS-preference listener at startup, before the Header mounts.
import '@/stores/theme.store'
import { Providers } from './app/providers'
import { AppRoutes } from './app/routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <AppRoutes />
    </Providers>
  </StrictMode>,
)
