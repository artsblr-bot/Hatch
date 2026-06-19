import path from 'path'
import { createRequire } from 'module'

// node_modules live on D:\ (J:\ is exFAT — no symlinks/junctions possible).
const require = createRequire('D:/hatch-modules/node_modules/')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const react = (require('@vitejs/plugin-react') as any).default

export default {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    modules: ['D:\\hatch-modules\\node_modules', 'node_modules'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'framer-motion', 'dexie', 'dexie-react-hooks'],
    entries: ['J:/Project Data/Hatch/src/**/*.{ts,tsx}'],
  },
  cacheDir: 'D:/hatch-modules/.vite',
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
}
