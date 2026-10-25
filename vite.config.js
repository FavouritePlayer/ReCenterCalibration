import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 4729,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 4729,
    strictPort: true,
  },
})
