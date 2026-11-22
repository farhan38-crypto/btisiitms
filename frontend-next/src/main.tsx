import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'
import { installErrorReporting } from './shell/Errors'

// Unexpected errors are sent to the server log (backend/logs/errors.log).
installErrorReporting()

// If a lazily loaded screen's file changed under us (new version, dev server rebuild),
// reload once instead of showing an error.
window.addEventListener('vite:preloadError', e => {
  if (sessionStorage.getItem('bits-reloaded')) return
  e.preventDefault(); sessionStorage.setItem('bits-reloaded', '1'); location.reload()
})
setTimeout(() => sessionStorage.removeItem('bits-reloaded'), 10000)

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
