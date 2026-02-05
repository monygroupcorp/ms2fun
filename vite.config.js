import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs';

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
            name: 'copy-runtime-assets',
            closeBundle() {
                // Copy index.html to 404.html for GitHub Pages SPA routing
                copyFileSync('dist/index.html', 'dist/404.html');

                // Copy src directory for runtime CSS loading (stylesheetLoader pattern)
                // This preserves paths like /src/routes/home.css that are loaded dynamically
                if (existsSync('src')) {
                    mkdirSync('dist/src', { recursive: true });
                    cpSync('src', 'dist/src', {
                        recursive: true,
                        filter: (src) => {
                            // Copy CSS files and config files needed at runtime
                            if (src.endsWith('.css')) return true;
                            if (src.endsWith('.json')) return true;
                            // Copy directories to traverse them
                            if (!src.includes('.')) return true;
                            return false;
                        }
                    });
                }
            }
        }
    ]
});
