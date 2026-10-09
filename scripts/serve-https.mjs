// Liefert den fertigen Build (dist/) per https mit selbst erzeugtem Zertifikat aus.
// Zum Testen am Handy im WLAN: Browser verlangen https für die Standortabfrage.
//   npm run serve:handy
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT ?? 4400);
const ROOT = join(process.cwd(), 'dist');
const CERT_DIR = join(process.cwd(), '.cache', 'cert');
if (!existsSync(ROOT)) throw new Error('dist/ fehlt. Zuerst "npm run build" ausführen.');

if (!existsSync(join(CERT_DIR, 'cert.pem'))) {
  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=schulfinder.local',
    '-keyout', join(CERT_DIR, 'key.pem'), '-out', join(CERT_DIR, 'cert.pem')], { stdio: 'ignore' });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

https
  .createServer({ key: readFileSync(join(CERT_DIR, 'key.pem')), cert: readFileSync(join(CERT_DIR, 'cert.pem')) }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://x');
    let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) return void res.writeHead(403).end();
    try {
      if (statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) return void res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
        file = join(file, 'index.html');
      }
      statSync(file);
    } catch {
      return void res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  })
  .listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log(`SchulFinder (Build) läuft:\n${ips.map((ip) => `  https://${ip}:${PORT}/`).join('\n')}`);
  });
