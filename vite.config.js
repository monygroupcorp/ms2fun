import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

export default defineConfig({
    root: '.',
    publicDir: 'public',
    appType: 'spa',
    server: {
        port: 3000,
        open: true
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html')
            }
        }
    },
    plugins: [
        {
            name: 'copy-404',
            closeBundle() {
                // Copy index.html to 404.html for GitHub Pages SPA routing
                copyFileSync('dist/index.html', 'dist/404.html');
            }
        }
    ]
});
