import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the built portal from the same address as the API (the Render test site): files as they are,
 * and index.html for every other address that isn't the API, so maisonfore…/coursename opens the portal.
 */
export function servePortal(app: FastifyInstance, dir: string, appDir?: string) {
  const root = normalize(dir) + sep;
  const index = join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`The portal isn't built: ${index} is missing. Run npm run build.`);
  const play = appDir && existsSync(join(appDir, 'index.html')) ? normalize(appDir) + sep : null;
  app.get('/*', async (req, reply) => {
    const raw = decodeURIComponent((req.url.split('?')[0] ?? '/'));
    if (raw.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.' });
    // The golfer app lives at /play.
    if (play && (raw === '/play' || raw.startsWith('/play/'))) {
      if (raw === '/play') return reply.redirect('/play/');
      return sendFrom(reply, play, raw.slice('/play'.length) || '/', raw.startsWith('/play/assets/'));
    }
    return sendFrom(reply, root, raw, raw.startsWith('/assets/'));
  });
}

function sendFrom(reply: import('fastify').FastifyReply, root: string, path: string, hashed: boolean) {
  const index = join(root, 'index.html');
  {
    const file = normalize(join(root, path));
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      return reply.header('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
        .header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache').send(readFileSync(file));
    }
    return reply.header('content-type', TYPES['.html']).header('cache-control', 'no-cache').send(readFileSync(index));
  }
}
