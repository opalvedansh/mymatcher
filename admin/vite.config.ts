import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import dotenv from 'dotenv';
import fs from 'node:fs';

// Load the backend .env so the admin panel can read SUPABASE_URL and
// SUPABASE_ANON_KEY at dev time without depending on the backend's
// /admin/env.js endpoint being up first.
const backendEnvPath = path.resolve(__dirname, '../backend/.env');
const backendEnv: Record<string, string> = fs.existsSync(backendEnvPath)
  ? (dotenv.parse(fs.readFileSync(backendEnvPath)) as Record<string, string>)
  : {};

export default defineConfig({
  plugins: [
    react(),
    // Inject window.__ADMIN_ENV__ inline so the SPA boots without a network
    // round-trip to /admin/env.js during local development.
    {
      name: 'inject-admin-env',
      transformIndexHtml(html) {
        const adminEnv = JSON.stringify({
          supabaseUrl: backendEnv.SUPABASE_URL || '',
          supabaseAnonKey: backendEnv.SUPABASE_ANON_KEY || '',
          commit: '',
          env: backendEnv.NODE_ENV || 'development',
        });
        // Replace the external env.js script tag with an inline one.
        // Vite may prepend the `base` path, producing /admin/admin/env.js.
        return html.replace(
          /<script src="(?:\/admin)*\/admin\/env\.js"><\/script>/,
          `<script>window.__ADMIN_ENV__=${adminEnv};</script>`,
        );
      },
    },
  ],
  // The panel is served from the API's own origin under /admin, so every
  // asset URL must be prefixed. Without this the bundle requests /assets/*
  // and gets the API's 404 JSON.
  base: '/admin/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // The panel is behind an admin login and served with a long max-age on
    // hashed filenames; one bundle keeps the cold start to a single request.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5180,
    // In dev the SPA runs on its own origin, so these are proxied to the local
    // backend. In production everything is same-origin and this is unused.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
