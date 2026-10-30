import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The circuit engine lives in ../src (shared with the Node scripts).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  worker: { format: 'es' },
})
