import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), {
    name: 'isolate-injected-content-scripts',
    generateBundle(_options, bundle) {
      // executeScript loads classic scripts into one shared isolated world. Keep
      // each injection's lexical bindings private, including repeated injections.
      for (const filename of ['assets/selector.js', 'assets/fullPage.js']) {
        const chunk = bundle[filename];
        if (!chunk || chunk.type !== 'chunk') this.error('Missing content-script bundle: ' + filename);
        if (chunk.imports.length || chunk.dynamicImports.length || chunk.exports.length) {
          this.error('Injected content scripts must be standalone: ' + filename);
        }
        chunk.code = '(() => {\n' + chunk.code + '\n})();\n';
      }
    },
  }],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        selector: resolve(__dirname, 'src/content/selector.ts'),
        fullPage: resolve(__dirname, 'src/content/full-page.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
