// vite.config.js
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'url';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load root .env first, then local .env overrides
config({ path: path.resolve(__dirname, '../.env') });
config(); // loads local .env

export default defineConfig({
  root: '.',
  server: {
    port: 9999,
    host: true,
    open: false,
    cors: true,                                                                           
     headers: {                                                                            
       'Access-Control-Allow-Origin': '*',                                                 
       'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',                      
       'Access-Control-Allow-Headers': '*',                                                
     }                                                                                     
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    },
    minify: 'esbuild',
    assetsInlineLimit: 0,
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  plugins: [
    wasm(), 
    topLevelAwait(),
    viteStaticCopy({
      targets: [{
        src: 'node_modules/@holonym-foundation/mishtiwasm/pkg/esm/mishtiwasm_bg.wasm',
        dest: 'assets'
      }]
    }),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      buffer: 'buffer',
      'react': path.resolve(__dirname, 'src/empty-module.ts'),
      'react-dom': path.resolve(__dirname, 'src/empty-module.ts'),
      'libsodium-wrappers-sumo': 'libsodium-wrappers-sumo',

    },
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo'],
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis',
      },
    },
  }
});