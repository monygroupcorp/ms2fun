import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, existsSync, mkdirSync, watch, readFileSync } from 'fs';
import { createHash } from 'crypto';

export default defineConfig({
    root: '.',
    publicDir: 'public',
    appType: 'spa',
    server: {
        port: 3000,
        open: true,
        watch: {
            // Ignore contracts.local.json - we handle it with SSE plugin
            ignored: ['**/contracts.local.json']
        }
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
            name: 'contract-reload-sse',
            configureServer(server) {
                const clients = new Set();
                const CONTRACT_CONFIG_PATH = resolve(__dirname, 'src/config/contracts.local.json');

                // Watch for contract config changes with content hashing
                if (existsSync(CONTRACT_CONFIG_PATH)) {
                    // Track last known content hash
                    let lastHash = null;
                    const getFileHash = () => {
                        try {
                            const content = readFileSync(CONTRACT_CONFIG_PATH, 'utf8');
                            return createHash('sha256').update(content).digest('hex');
                        } catch (err) {
                            return null;
                        }
                    };

                    // Initialize with current hash
                    lastHash = getFileHash();

                    let debounceTimer = null;
                    const watcher = watch(CONTRACT_CONFIG_PATH, (eventType) => {
                        if (eventType === 'change') {
                            // Clear existing timer
                            if (debounceTimer) {
                                clearTimeout(debounceTimer);
                            }

                            // Debounce: only check after 200ms of no changes
                            debounceTimer = setTimeout(() => {
                                const currentHash = getFileHash();

                                // Only notify if content actually changed
                                if (currentHash && currentHash !== lastHash) {
                                    console.log('[ContractReloadSSE] Contract config changed - notifying clients...');
                                    lastHash = currentHash;

                                    // Notify all connected clients
                                    clients.forEach(client => {
                                        client.write(`data: ${JSON.stringify({ type: 'contract-config-changed' })}\n\n`);
                                    });
                                }
                                debounceTimer = null;
                            }, 200);
                        }
                    });

                    server.httpServer?.on('close', () => {
                        if (debounceTimer) {
                            clearTimeout(debounceTimer);
                        }
                        watcher.close();
                    });
                }

                // SSE endpoint
                server.middlewares.use('/api/contract-reload-events', (req, res) => {
                    if (req.method !== 'GET') {
                        res.statusCode = 405;
                        res.end();
                        return;
                    }

                    // Set SSE headers
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'Access-Control-Allow-Origin': '*',
                    });

                    // Send initial connected message
                    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

                    // Add client to set
                    clients.add(res);

                    // Send heartbeat every 30 seconds to keep connection alive
                    const heartbeat = setInterval(() => {
                        res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
                    }, 30000);

                    // Clean up on disconnect
                    req.on('close', () => {
                        clearInterval(heartbeat);
                        clients.delete(res);
                    });
                });
            }
        },
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
