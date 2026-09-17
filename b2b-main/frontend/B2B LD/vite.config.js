import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  // Served under /b2b/ in production (VPS path-based routing alongside the
  // B2C app on the same domain). UAT owns its domain root instead
  // (uat.legaldesk.com/), with B2C moved to /b2c/ there. Local dev stays at /.
  base: mode === 'production' ? '/b2b/' : mode === 'uat' ? '/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  }
}))