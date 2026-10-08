import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: mode === 'release' ? false : 'public',
  define: { 'import.meta.env.VITE_INCLUDE_LEGACY': JSON.stringify(mode === 'release' ? '0' : '1') },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
}));
