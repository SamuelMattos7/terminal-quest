import { statSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Opt-in for the production entry point; development continues to use Vite. */
export async function registerWebDelivery(app: FastifyInstance, webRoot: string): Promise<void> {
  try {
    if (!statSync(join(webRoot, 'index.html')).isFile()) throw new Error('index is not a file');
  } catch (cause) {
    throw new Error(`Missing web build at ${webRoot}; run pnpm build before starting the server`, {
      cause,
    });
  }

  // Only Vite's public assets are mounted, never the repository/content tree.
  await app.register(fastifyStatic, {
    root: join(webRoot, 'assets'),
    prefix: '/assets/',
    index: false,
    dotfiles: 'deny',
    maxAge: 0,
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    const accept = request.headers.accept;
    const navigation = request.method === 'GET' || request.method === 'HEAD';
    const wantsHtml =
      accept === undefined || accept.includes('text/html') || accept.includes('*/*');
    const reserved = /^\/(?:api|ws|healthz|assets)(?:\/|$)/.test(path);
    // Encoded/dotted paths are never client routes (missing files stay 404).
    if (navigation && wantsHtml && !reserved && !/[.%\\]/.test(path)) {
      return reply.sendFile('index.html', webRoot, { maxAge: 0, immutable: false });
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}
