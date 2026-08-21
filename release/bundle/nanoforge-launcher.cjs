/**
 * NanoForge Dual Launcher (scripts/nanoforge-launcher.cjs)
 *
 * Coordinates standalone execution:
 * 1. Starts the Fastify Agent Host daemon (port 4174 by default).
 * 2. Serves the Vite production `dist/` web UI (port 4173 by default) with MIME type handling and SPA routing fallback.
 * 3. Generates a secure session authentication token.
 * 4. Automatically opens the default browser to `http://127.0.0.1:4173/?hostPort=4174&token=...`.
 * 5. Handles graceful process shutdown (SIGINT/SIGTERM) for both servers.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, exec } = require('node:child_process');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    uiPort: Number(process.env.NANOFORGE_PORT || process.env.NANOFORGE_UI_PORT || 4173),
    hostPort: Number(process.env.NANOFORGE_HOST_PORT || process.env.HOST_PORT || 4174),
    token: process.env.NANOFORGE_TOKEN || process.env.TOKEN || '',
    noOpen: process.env.NANOFORGE_NO_OPEN === '1' || process.env.NANOFORGE_NO_OPEN === 'true' || Boolean(process.env.CI),
    dryRun: false,
    distRoot: '',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p' || arg === '--ui-port') {
      args.uiPort = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      args.uiPort = Number(arg.split('=')[1]);
    } else if (arg === '--host-port' || arg === '--hostPort') {
      args.hostPort = Number(argv[++i]);
    } else if (arg.startsWith('--host-port=')) {
      args.hostPort = Number(arg.split('=')[1]);
    } else if (arg === '--token' || arg === '-t') {
      args.token = argv[++i];
    } else if (arg.startsWith('--token=')) {
      args.token = arg.split('=')[1];
    } else if (arg === '--no-open' || arg === '--headless') {
      args.noOpen = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.noOpen = true;
    } else if (arg === '--root' || arg === '--dist') {
      args.distRoot = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  if (!args.token) {
    args.token = generateToken();
  }

  return args;
}

function resolveDistRoot(customRoot) {
  if (customRoot && fs.existsSync(customRoot)) {
    return path.resolve(customRoot);
  }

  const candidates = [
    // 1. Process pkg / executable adjacent dist
    process.pkg ? path.join(path.dirname(process.execPath), 'dist') : null,
    // 2. Local sibling dist directory
    path.join(__dirname, 'dist'),
    // 3. Local parent dist directory (release/bundle/dist or root dist)
    path.join(__dirname, '..', 'dist'),
    // 4. Release dist directory
    path.join(__dirname, '..', 'release', 'dist'),
    // 5. Release bundle dist directory
    path.join(__dirname, '..', 'release', 'bundle', 'dist'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return path.resolve(candidate);
    }
  }

  // Fallback to closest dist candidate even if index.html is missing
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return path.resolve(path.join(__dirname, '..', 'dist'));
}

function resolveHostEntry() {
  const candidates = [
    // 1. Packaged bundle host script
    path.join(__dirname, 'agent-host.cjs'),
    path.join(__dirname, 'server.cjs'),
    path.join(__dirname, 'server.mjs'),
    path.join(path.dirname(process.execPath), 'agent-host.cjs'),
    // 2. Apps agent-host compiled dist
    path.join(__dirname, '..', 'apps', 'agent-host', 'dist', 'server.cjs'),
    path.join(__dirname, '..', 'apps', 'agent-host', 'dist', 'server.mjs'),
    path.join(__dirname, '..', 'release', 'bundle', 'agent-host.cjs'),
    // 3. TypeScript source (development / monorepo mode)
    path.join(__dirname, '..', 'apps', 'agent-host', 'src', 'server.ts'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function createStaticServer(distRoot) {
  return http.createServer((req, res) => {
    // Normalization & sanitization
    const rawUrl = req.url || '/';
    const cleanPath = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
    const normalized = path.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, '');
    const relativeTarget = normalized === '/' || normalized === '\\' ? 'index.html' : normalized.replace(/^[\/\\]+/, '');
    const candidateFile = path.resolve(distRoot, relativeTarget);

    // Path traversal check
    if (!candidateFile.startsWith(distRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(candidateFile, (err, stats) => {
      if (!err && stats.isFile()) {
        const stream = fs.createReadStream(candidateFile);
        res.writeHead(200, {
          'Content-Type': getMimeType(candidateFile),
          'Content-Length': stats.size,
          'X-Content-Type-Options': 'nosniff',
        });
        stream.pipe(res);
        return;
      }

      // SPA fallback to index.html for client-side routing
      const indexFile = path.join(distRoot, 'index.html');
      fs.stat(indexFile, (indexErr, indexStats) => {
        if (!indexErr && indexStats.isFile()) {
          const indexStream = fs.createReadStream(indexFile);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': indexStats.size,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          });
          indexStream.pipe(res);
          return;
        }

        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>NanoForge - Build Required</title></head>
            <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem;">
              <h1 style="color: #f59e0b;">NanoForge Production Build Not Found</h1>
              <p>The web UI assets were not found at <code>${distRoot}</code>.</p>
              <p>Please compile the frontend using: <code>npm run build</code></p>
            </body>
          </html>
        `);
      });
    });
  });
}

function openBrowser(url) {
  const platform = process.platform;
  let command = '';

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.warn(`[launcher] Note: Could not auto-launch browser automatically: ${err.message}`);
      console.log(`[launcher] Please navigate manually to: ${url}`);
    }
  });
}

async function startLauncher(options = {}) {
  const config = Object.assign({}, parseArgs(), options);

  if (config.help) {
    console.log(`
NanoForge Standalone Dual Launcher
Usage: node nanoforge-launcher.cjs [options]

Options:
  --port, -p, --ui-port <port>    Web UI static server port (default: 4173)
  --host-port <port>              Agent host daemon port (default: 4174)
  --token, -t <token>             Authentication session token (default: generated)
  --root <path>                   Custom static dist root directory
  --no-open, --headless           Do not automatically open default browser
  --dry-run                       Validate configuration and exit cleanly
  --help, -h                      Show this help message
`);
    return { status: 'help' };
  }

  const distRoot = resolveDistRoot(config.distRoot);
  const hostEntry = resolveHostEntry();

  console.log('===================================================');
  console.log('       NanoForge Phase 6 - Platform Launcher       ');
  console.log('===================================================');
  console.log(`[launcher] UI Root:     ${distRoot}`);
  console.log(`[launcher] Host Entry:  ${hostEntry || 'None found (will start UI only)'}`);
  console.log(`[launcher] Host Port:   ${config.hostPort}`);
  console.log(`[launcher] UI Port:     ${config.uiPort}`);
  console.log(`[launcher] Auth Token:  ${config.token.slice(0, 8)}... (redacted)`);

  let hostProcess = null;

  // 1. Start Fastify Agent Host daemon if host entry exists
  if (hostEntry && !config.dryRun) {
    const isTypeScript = hostEntry.endsWith('.ts');
    const isWindows = process.platform === 'win32';

    const env = Object.assign({}, process.env, {
      PORT: String(config.hostPort),
      TOKEN: config.token,
      HOST: '127.0.0.1',
    });

    if (isTypeScript) {
      const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', isWindows ? 'tsx.cmd' : 'tsx');
      const cmd = fs.existsSync(tsxBin) ? tsxBin : (isWindows ? 'npx.cmd' : 'npx');
      const args = fs.existsSync(tsxBin) ? [hostEntry] : ['tsx', hostEntry];

      hostProcess = spawn(cmd, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows,
        windowsHide: true,
      });
    } else {
      hostProcess = spawn(process.execPath, [hostEntry], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    }

    if (hostProcess) {
      hostProcess.stdout?.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[agent-host] ${text}`);
      });

      hostProcess.stderr?.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[agent-host] ${text}`);
      });

      hostProcess.on('error', (err) => {
        console.error(`[launcher] Failed to spawn agent host: ${err.message}`);
      });

      hostProcess.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.warn(`[launcher] Agent host process exited with code ${code} (${signal || 'none'})`);
        }
      });
    }
  }

  // 2. Start Web UI Static Server
  const uiServer = createStaticServer(distRoot);

  const serverPromise = new Promise((resolve, reject) => {
    uiServer.once('error', (err) => {
      console.error(`[launcher] UI Server Error: ${err.message}`);
      reject(err);
    });

    uiServer.listen(config.uiPort, '127.0.0.1', () => {
      const launchUrl = `http://127.0.0.1:${config.uiPort}/?hostPort=${config.hostPort}&token=${encodeURIComponent(config.token)}`;
      console.log(`[launcher] Web UI ready at:   http://127.0.0.1:${config.uiPort}`);
      console.log(`[launcher] Agent Host URL:   ws://127.0.0.1:${config.hostPort}/agent?token=${config.token.slice(0, 8)}...`);
      console.log(`[launcher] Browser URL:      ${launchUrl}`);
      console.log('===================================================');

      if (!config.noOpen && !config.dryRun) {
        openBrowser(launchUrl);
      }

      resolve({
        uiServer,
        hostProcess,
        launchUrl,
        config,
        distRoot,
      });
    });
  });

  const handle = await serverPromise;

  const shutdown = async () => {
    console.log('\n[launcher] Shutting down NanoForge services...');
    if (hostProcess && !hostProcess.killed) {
      try {
        if (process.platform === 'win32' && hostProcess.pid) {
          exec(`taskkill /pid ${hostProcess.pid} /T /F`, () => {});
        } else {
          hostProcess.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
    }

    if (uiServer) {
      await new Promise((res) => uiServer.close(res));
    }
    console.log('[launcher] NanoForge stopped cleanly.');
  };

  process.once('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  if (config.dryRun) {
    console.log('[launcher] Dry run completed successfully.');
    await shutdown();
  }

  return {
    ...handle,
    shutdown,
  };
}

// Direct CLI invocation check
if (require.main === module) {
  startLauncher().catch((err) => {
    console.error(`[launcher] Fatal initialization error:`, err);
    process.exit(1);
  });
}

module.exports = {
  startLauncher,
  resolveDistRoot,
  resolveHostEntry,
  getMimeType,
  generateToken,
  parseArgs,
  createStaticServer,
  MIME_TYPES,
};
