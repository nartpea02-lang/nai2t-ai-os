/* Minimal static file server for tests. Serves public/ — the same directory
   Netlify publishes — resolving directory requests to their index.html
   (so /atlas/ -> /atlas/index.html). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public');
const PORT = process.env.PORT || 4321;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  let fsPath = path.join(ROOT, urlPath);
  try {
    if (fs.existsSync(fsPath) && fs.statSync(fsPath).isDirectory()) {
      fsPath = path.join(fsPath, 'index.html');
    }
  } catch (e) {}
  if (!fsPath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fsPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fsPath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('serving ' + ROOT + ' on http://localhost:' + PORT));
module.exports = server;
