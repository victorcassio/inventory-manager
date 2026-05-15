import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Providers } from './app/providers'
import { AppRoutes } from './app/routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <AppRoutes />
    </Providers>
  </StrictMode>,
)
