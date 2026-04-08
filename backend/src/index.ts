import Fastify from 'fastify';
import cors from '@fastify/cors';
import { conversationsRoutes } from './routes/conversations.js';
import { messagesRoutes } from './routes/messages.js';
import { activitiesRoutes } from './routes/activities.js';
import { statsRoutes } from './routes/stats.js';
import { metadataRoutes } from './routes/metadata.js';
import { importRoutes } from './routes/import.js';
import { countsRoutes } from './routes/counts.js';
import { tagRoutes } from './routes/tags.js';
import { anchorRoutes } from './routes/anchors.js';

const fastify = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024, // 100MB
});

// Register CORS
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4000',
  credentials: true,
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
fastify.register(conversationsRoutes, { prefix: '/api/conversations' });
fastify.register(messagesRoutes, { prefix: '/api/messages' });
fastify.register(activitiesRoutes, { prefix: '/api/activities' });
fastify.register(statsRoutes, { prefix: '/api/stats' });
fastify.register(metadataRoutes, { prefix: '/api/metadata' });
fastify.register(importRoutes, { prefix: '/api/import' });
fastify.register(countsRoutes, { prefix: '/api/counts' });
fastify.register(tagRoutes, { prefix: '/api/tags' });
fastify.register(anchorRoutes, { prefix: '/api/anchors' });

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
