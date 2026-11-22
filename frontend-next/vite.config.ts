import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The FastAPI backend runs on :8000. The dev server forwards /api to it, so the browser only
// ever talks to one address: no CORS, and it works from a phone on the same Wi-Fi or through
// the ngrok link that start.sh opens.
export default defineConfig(({ mode }) => {
  // Settings the classic app already has (frontend/.env) are reused, so Google sign-in keeps
  // working without setting it up again. frontend-next/.env wins when both are set.
  const classic = loadEnv(mode, '../frontend', 'REACT_APP_')
  const own = loadEnv(mode, '.', 'VITE_')
  const googleId = own.VITE_GOOGLE_CLIENT_ID || classic.REACT_APP_GOOGLE_CLIENT_ID || ''
  return {
    plugins: [react(), tailwindcss()],
    define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(googleId) },
    server: {
      port: Number(process.env.PORT) || 3000,
      host: true,
      // ngrok (and other tunnels) send their own host name; Vite refuses unknown hosts otherwise.
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io', '.ngrok.dev', 'localhost'],
      // In Docker on a Mac or Windows, file changes from the host only arrive by polling.
      watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
      proxy: { '/api': { target: process.env.BACKEND_URL || process.env.BACKEND_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } },
    },
    // Scan every screen up front (most screens load lazily). Otherwise the dev server
    // discovers their libraries on first visit, rebuilds, and that first visit fails.
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.{ts,tsx}'],
      include: ['sonner', 'canvas-confetti', 'maplibre-gl', 'three',
        '@react-three/fiber', '@react-three/drei', 'react-force-graph-3d', '@paper-design/shaders-react', 'motion/react', 'lucide-react'],
    },
    preview: { port: 3000, host: true },
    build: { chunkSizeWarningLimit: 2000 },
  }
})
