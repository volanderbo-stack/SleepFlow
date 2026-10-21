import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `--mode https` (npm run dev:https) — самопідписаний сертифікат, щоб тестувати мікрофон і датчики з телефона в локальній мережі.
// `--mode pages` (npm run build:pages) — збірка для GitHub Pages, де сайт живе в підпапці /SleepFlow/.
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/SleepFlow/' : '/',
  build: {
    // Recharts сам по собі ~550 кБ; він кешується service worker'ом, тож для офлайн-PWA це прийнятно.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'dexie', 'zustand'] },
      },
    },
  },
  plugins: [
    ...(mode === 'https' ? [basicSsl()] : []),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'SleepFlow — трекер сну',
        short_name: 'SleepFlow',
        description: 'Трекер і аналізатор сну. Усі дані лише на вашому пристрої.',
        lang: 'uk',
        // Відносно маніфесту — працює і в корені, і в підпапці GitHub Pages.
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0B1020',
        background_color: '#0B1020',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
}));
