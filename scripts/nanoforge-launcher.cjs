const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const root = process.pkg
  ? path.join(path.dirname(process.execPath), 'dist')
  : path.join(__dirname, '..', 'dist');
const port = Number(process.env.NANOFORGE_PORT || 4173);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const requested = decodeURIComponent((req.url || '/').split('?')[0]);
  const candidate = path.resolve(root, requested === '/' ? 'index.html' : `.${requested}`);
  const file = candidate.startsWith(path.resolve(root)) ? candidate : path.join(root, 'index.html');
  fs.readFile(file, (error, data) => {
    if (error) {
      fs.readFile(path.join(root, 'index.html'), (fallbackError, fallback) => {
        res.writeHead(fallbackError ? 404 : 200, { 'Content-Type': 'text/html' });
        res.end(fallbackError ? 'NanoForge build not found. Run npm run build first.' : fallback);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`NanoForge running at ${url}`);
  exec(`start "" "${url}"`);
});
