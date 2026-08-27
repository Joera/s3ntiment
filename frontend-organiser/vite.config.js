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

config({ path: path.resolve(__dirname, '../.env') });
config(); 

export default defineConfig({
  root: '.',
  server: {
    port: 7783,
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
        // manualChunks(id) {
        //   if (id.includes('node_modules')) return 'vendor';
        // }
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
      'react-dom': path.resolve(__dirname, 'src/empty-module.ts')
    },
  },
  optimizeDeps: {
    include: [],
    exclude: ["@s3ntiment/shared"],
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis',
      },
    },
  },
});