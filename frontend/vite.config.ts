import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/clan-node/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/reactflow/') || id.includes('/react-dom/') || id.includes('/react/')) return 'ui-vendor';
          if (id.includes('/qrcode/')) return 'qrcode-vendor';
          if (id.includes('/opencc-js/') || id.includes('/pinyin-pro/')) return 'search-vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
