import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const allowedHosts = Array.from(new Set(
  String(process.env.ALLOWED_HOSTS || 'droply.click,staging.droply.click,localhost')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Keep Vite dep cache out of /app/node_modules to avoid cross-device rename errors in containerized runtime.
  cacheDir: '/tmp/tg-messaging-saas-vite-cache',
  server: {
    allowedHosts,
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
