import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const clerkPublishableKey =
      env.VITE_CLERK_PUBLISHABLE_KEY ||
      env.CLERK_PUBLISHABLE_KEY ||
      process.env.VITE_CLERK_PUBLISHABLE_KEY ||
      process.env.CLERK_PUBLISHABLE_KEY ||
      '';
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        // Proxy API calls to the local Wrangler dev server to avoid HTML responses in Vite
        '/api': {
          target: env.VITE_FUNCTIONS_ORIGIN || 'http://127.0.0.1:8788',
          changeOrigin: true,
        },
      },
    },
      plugins: [
        tailwindcss(),
        react()
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        '__CLERK_PUBLISHABLE_KEY__': JSON.stringify(clerkPublishableKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
