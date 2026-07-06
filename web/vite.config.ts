import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the app works both at the domain root and
  // behind a reverse-proxy subpath (e.g. nginx location /yesod/).
  base: './',
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:9999' },
  },
})
