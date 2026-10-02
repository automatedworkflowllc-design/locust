import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SplashApp } from './SplashApp'
import { WindowFallback } from './components/WindowFallback'
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

/*
 * THE PAGE ITSELF HAS TO BE TRANSPARENT, not just the window.
 *
 * Making the BrowserWindow transparent was not enough and the black square
 * stayed exactly where it was (Colin, twice). `shell.css` paints `body`
 * with `--lc-bg-app`, and the loading window loads the same stylesheet --
 * so the window was see-through and the page drawn on it was not.
 *
 * Marked on the root element rather than by a wrapper, because `html` and
 * `body` are above anything a component can reach.
 */
if (isSplash) document.documentElement.classList.add('is-splash')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSplash ? <SplashApp /> : <WindowFallback><App /></WindowFallback>}</StrictMode>
)
