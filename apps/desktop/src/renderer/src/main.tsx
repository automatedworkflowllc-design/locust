import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SplashApp } from './SplashApp'
// Tokens first: the shell's palette, type and motion, plus the vendored Geist
// faces. Then the shell itself, which consumes only those tokens.
import './tokens.css'
import './shell.css'

/*
 * Two windows, one bundle.
 *
 * The loading window is a second `BrowserWindow` on the same renderer with
 * `#splash` on the URL. One bundle rather than a second entry point, so
 * there is no way for the boot screen to exist in two builds that drift.
 */
const isSplash = window.location.hash === '#splash'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSplash ? <SplashApp /> : <App />}</StrictMode>
)
