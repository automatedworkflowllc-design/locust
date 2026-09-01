import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Tokens first: the shell's palette, type and motion, plus the vendored Geist
// faces. Then the shell itself, which consumes only those tokens.
import './tokens.css'
import './shell.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
