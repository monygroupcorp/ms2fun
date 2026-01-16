const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Track contract config changes
let contractConfigVersion = Date.now();
const contractConfigPath = path.join(__dirname, 'src/config/contracts.local.json');

// Watch for contract config changes
// Use mtime check because fs.watch on macOS fires spuriously on file reads
let lastMtime = fs.existsSync(contractConfigPath) ? fs.statSync(contractConfigPath).mtimeMs : 0;
if (fs.existsSync(contractConfigPath)) {
    fs.watch(contractConfigPath, (eventType) => {
        if (eventType === 'change') {
            // Only trigger if file was actually modified
            const currentMtime = fs.statSync(contractConfigPath).mtimeMs;
            if (currentMtime === lastMtime) return;
            lastMtime = currentMtime;

            contractConfigVersion = Date.now();
            console.log('🔄 Contract config changed - browser will reload contract adapters');
            // Broadcast to all SSE clients
            broadcastConfigChange();
        }
    });
    console.log('👀 Watching for contract config changes:', contractConfigPath);
}

// SSE clients for contract reload notifications
const sseClients = new Set();

function broadcastConfigChange() {
    for (const client of sseClients) {
        client.write(`data: ${JSON.stringify({ type: 'contract-config-changed', version: contractConfigVersion })}\n\n`);
    }
}

// SSE endpoint for contract reload notifications
app.get('/api/contract-reload-events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', version: contractConfigVersion })}\n\n`);

    // Add client to set
    sseClients.add(res);

    // Remove client on disconnect
    req.on('close', () => {
        sseClients.delete(res);
    });
});

// Disable caching for development
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Expires', '-1');
    res.set('Pragma', 'no-cache');
    next();
});

// Debug middleware to log all requests
app.use((req, res, next) => {
    //console.log('Request URL:', req.url);
    next();
});

// Set correct MIME types for ALL requests
app.use((req, res, next) => {
    // Log the requested path
    //console.log('Checking MIME type for:', req.path);
    
    if (req.path.endsWith('.js')) {
        //console.log('Setting JS MIME type for:', req.path);
        res.set('Content-Type', 'application/javascript');
        // Force fresh response
        res.set('ETag', Date.now().toString());
    } else if (req.path.endsWith('.css')) {
        res.set('Content-Type', 'text/css');
    } else if (req.path.endsWith('.woff2')) {
        res.set('Content-Type', 'font/woff2');
        res.set('Access-Control-Allow-Origin', '*');
    } else if (req.path.endsWith('.woff')) {
        res.set('Content-Type', 'font/woff');
        res.set('Access-Control-Allow-Origin', '*');
    }
    next();
});

// Serve static files from the root directory
// This middleware will only serve files that actually exist
// If a file doesn't exist, it calls next() and the request continues
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        //console.log('Serving static file:', filePath);
        if (filePath.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
            res.set('Content-Type', 'text/css');
        } else if (filePath.endsWith('.woff2')) {
            res.set('Content-Type', 'font/woff2');
            res.set('Access-Control-Allow-Origin', '*');
        } else if (filePath.endsWith('.woff')) {
            res.set('Content-Type', 'font/woff');
            res.set('Access-Control-Allow-Origin', '*');
        }
    },
    // Disable etag to prevent 304s
    etag: false,
    // Disable last-modified to prevent 304s
    lastModified: false,
    // Only serve files that exist
    fallthrough: true
}));

// This should be LAST - the catch-all route
// Mimic GitHub Pages behavior: serve 404.html for missing routes
app.get('*', (req, res) => {
    console.log('Fallback route hit for:', req.url, '- serving 404.html (GitHub Pages behavior)');
    res.sendFile(path.join(__dirname, '404.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 