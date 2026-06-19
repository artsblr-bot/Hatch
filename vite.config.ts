import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Portable config — resolves dependencies via standard node_modules lookup so it
// works on Vercel (and any clean checkout), not just this dev machine.
// (Local builds on the exFAT USB run through the D:\hatch-build sandbox, whose
// node_modules is junctioned to the real module set — see project memory.)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ai-vendor': ['ai', '@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/openai-compatible', '@ai-sdk/react'],
          'db-vendor': ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
})
