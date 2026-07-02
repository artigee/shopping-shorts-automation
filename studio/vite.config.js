import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// New pipeline studio front-end (separate from the old webapp/, which stays untouched).
// Reuses the SAME backend on :5174 — all /api calls are proxied there.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': 'http://localhost:5174' },
  },
})
