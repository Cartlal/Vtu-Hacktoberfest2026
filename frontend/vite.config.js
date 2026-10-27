import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :4000 and Vite proxies /api to it, so the
// frontend always calls same-origin /api (as it does in production on Render).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' }
  }
});
