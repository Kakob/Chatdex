// JWT verification middleware. Decorates the request with `userId` if the
// token is valid; sends 401 otherwise. Routes opt in by adding
// { preHandler: app.authenticate } to their options.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET env var must be set and at least 32 chars');
  }
  await app.register(fastifyJwt, { secret });

  app.decorate(
    'authenticate',
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        const decoded = await req.jwtVerify<{ sub: string; email: string }>();
        req.userId = decoded.sub;
      } catch {
        await reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  );
}
