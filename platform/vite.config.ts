import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8789',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            // Preserve CSRF checking across the split-port local preview.
            // Foreign origins are never rewritten into a trusted origin.
            if (incoming.headers.origin === 'http://127.0.0.1:5173') {
              request.setHeader('origin', 'http://127.0.0.1:8789');
            }
          });
        },
      },
      '/v1': 'http://127.0.0.1:8789',
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
