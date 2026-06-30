import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 프론트(5173) → 백엔드(5174) 프록시. /api 호출은 모두 서버로 넘김.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5174',
    },
  },
})
