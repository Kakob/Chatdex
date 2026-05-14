import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { registerAuth } from './middleware/auth.js';

const fastify = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024, // 100MB
});

// Register CORS
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4000',
  credentials: true,
});

// JWT + the `authenticate` decorator. Must be registered before any route uses it.
await registerAuth(fastify);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(syncRoutes, { prefix: '/api/sync' });

// Start server
const port = parseInt(process.env.PORT || '3003', 10);
const host = '0.0.0.0';

try {
  await fastify.listen({ port, host });
  console.log(`Server listening on http://${host}:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
