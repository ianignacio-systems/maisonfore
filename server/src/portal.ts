import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the built portal from the same address as the API (the Render test site): files as they are,
 * and index.html for every other address that isn't the API, so maisonfore…/coursename opens the portal.
 */
export function servePortal(app: FastifyInstance, dir: string) {
  const root = normalize(dir) + sep;
  const index = join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`The portal isn't built: ${index} is missing. Run npm run build.`);
  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/'));
    if (path.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.' });
    const file = normalize(join(root, path));
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      const hashed = path.startsWith('/assets/');
      return reply.header('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
        .header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache').send(readFileSync(file));
    }
    return reply.header('content-type', TYPES['.html']).header('cache-control', 'no-cache').send(readFileSync(index));
  });
}
