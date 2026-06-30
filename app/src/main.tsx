import './styles/reset.css'
import './styles/tokens.css'
import './styles/system.css'
// NOESIS design system (vendored) — tokens then devices, both scoped to
// [data-brand="noesis"] so nothing leaks onto :root. See styles/noesis/VENDORED.md.
import './styles/noesis/theme.css'
import './styles/noesis/signature.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
