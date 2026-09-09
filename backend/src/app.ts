import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { llmRoutes } from './routes/llm.js';
import { registerAuth } from './middleware/auth.js';
import type { Db } from './db/index.js';

export interface BuildAppOptions {
  /** Database handle. Production passes the postgres-js one; tests pass PGlite. */
  db: Db;
  /** Fastify logger option. Tests pass a capturing stream to assert on log output. */
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
}

/**
 * Build the Fastify app without listening. index.ts calls this and listens;
 * tests call it and use app.inject(). Everything that shapes a request —
 * CORS, body limit, JWT, the route plugins — lives here so tests exercise
 * the same instance production runs.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 100 * 1024 * 1024, // 100MB
  });

  await app.register(cors, {
    origin: opts.corsOrigin ?? process.env.CORS_ORIGIN ?? 'http://localhost:4000',
    credentials: true,
  });

  // JWT + the `authenticate` decorator. Must be registered before any route uses it.
  await registerAuth(app);

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: '/api/auth', db: opts.db });
  await app.register(syncRoutes, { prefix: '/api/sync', db: opts.db });
  // Transit-only LLM relay (CLAUDE.md invariant 6): forwards to the user's own
  // provider account; never persists or logs request/response content.
  await app.register(llmRoutes, { prefix: '/api/llm' });

  return app;
}
