import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initThemePalette } from './lib/themePalette.ts'

// Hydrate saved theme palette directly into CSS variables before mount
initThemePalette()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
