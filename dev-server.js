const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const RELOAD_SCRIPT = `
<!-- Hot Reload Script -->
<script>
(() => {
  let isConnected = false;
  function connect() {
    const es = new EventSource('/__livereload');
    es.onopen = () => {
      if (isConnected) {
        location.reload();
      }
      isConnected = true;
      console.log('[live-reload] Connecté au serveur');
    };
    es.onmessage = (e) => {
      if (e.data === 'reload') {
        console.log('[live-reload] Fichier modifié -> Rechargement automatique...');
        location.reload();
      }
    };
    es.onerror = () => {
      es.close();
      setTimeout(connect, 1000);
    };
  }
  connect();
})();
</script>
`;

const clients = new Set();

function broadcastReload(file) {
  const filename = path.basename(file);
  console.log(`\x1b[36m[hot-reload]\x1b[0m Fichier modifié : \x1b[33m${filename}\x1b[0m -> rechargement du navigateur`);
  for (const res of clients) {
    try {
      res.write('data: reload\n\n');
    } catch {
      clients.delete(res);
    }
  }
}

// Watch public directory
let debounceTimer = null;
try {
  fs.watch(PUBLIC_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.')) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      broadcastReload(filename);
    }, 80);
  });
} catch (err) {
  console.error('Erreur lors de la surveillance des fichiers :', err);
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // SSE livereload endpoint
  if (pathname === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':\n\n');
    clients.add(res);

    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  // Resolve file in public/
  let filePath = path.join(PUBLIC_DIR, pathname);

  // Security check: ensure path stays within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // Check if directory
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (err) {}

  // If file doesn't exist, try appending .html (e.g. /staging -> /staging.html)
  if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>Le fichier <code>${pathname}</code> n'a pas été trouvé dans <code>public/</code>.</p></body></html>`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (ext === '.html') {
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }
      let injectedContent;
      if (content.includes('</body>')) {
        injectedContent = content.replace('</body>', `${RELOAD_SCRIPT}</body>`);
      } else if (content.includes('</html>')) {
        injectedContent = content.replace('</html>', `${RELOAD_SCRIPT}</html>`);
      } else {
        injectedContent = content + RELOAD_SCRIPT;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(injectedContent);
    });
  } else {
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\x1b[32m✔ Serveur local démarré avec succès !\x1b[0m`);
  console.log(`➜ \x1b[1mURL principale :\x1b[0m   \x1b[34mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`➜ \x1b[1mPages disponibles :\x1b[0m`);
  console.log(`   - http://localhost:${PORT}/`);
  console.log(`   - http://localhost:${PORT}/staging.html`);
  console.log(`   - http://localhost:${PORT}/mentions-legales.html`);
  console.log(`➜ \x1b[1mHot reload :\x1b[0m      Actif (surveille les changements dans ./public)`);
});
