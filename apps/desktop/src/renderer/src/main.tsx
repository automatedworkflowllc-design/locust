import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Tokens first: the shell's palette, type and motion, plus the vendored Geist
// faces. `styles.css` is the pre-redesign stylesheet and is retired in P1.
import './tokens.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
