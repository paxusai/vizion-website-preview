// Minimal local preview server for the built site (./site), for machines where
// PowerShell scripts are blocked. Same behaviour as tools/serve.ps1.
// Usage (from the project root):  node tools/serve.js [port]
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 8080;
const root = path.resolve(__dirname, '..', 'site');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf'
};

function send(res, status, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); res.end(); return; }
    res.writeHead(status, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { urlPath = '/'; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.resolve(root, '.' + urlPath);
  fs.stat(file, (err, stat) => {
    if (!file.startsWith(root + path.sep) || err || !stat.isFile()) send(res, 404, path.join(root, '404.html'));
    else send(res, 200, file);
  });
}).listen(port, 'localhost', () => {
  console.log(`Serving ${root} at http://localhost:${port}/  (Ctrl+C to stop)`);
});
