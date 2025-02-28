const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

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
    }
    next();
});

// Serve static files from the root directory
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        //console.log('Serving static file:', filePath);
        if (filePath.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript');
        }
    },
    // Disable etag to prevent 304s
    etag: false,
    // Disable last-modified to prevent 304s
    lastModified: false
}));

// This should be AFTER static file serving
app.get('*', (req, res) => {
    //console.log('Fallback route hit for:', req.url);
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 