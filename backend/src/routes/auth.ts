import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, users } from '../db/index.js';
import { b64ToBuf, bufToB64 } from '../utils/binary.js';
import { hashAuthKey, newServerSalt, verifyAuthKey } from '../utils/passwordHash.js';

const SealedSchema = z.object({
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

const KdfParamsSchema = z.object({
  algorithm: z.literal('argon2id'),
  iterations: z.number().int().positive(),
  memoryKiB: z.number().int().positive(),
  parallelism: z.number().int().positive(),
  hashBytes: z.number().int().positive(),
});

const SignupSchema = z.object({
  email: z.string().email(),
  authKey: z.string().min(1), // base64
  saltAuth: z.string().min(1),
  saltEnc: z.string().min(1),
  kdfParams: KdfParamsSchema,
  wrappedByPassphrase: SealedSchema,
  wrappedByRecovery: SealedSchema,
});

const ChallengeSchema = z.object({
  email: z.string().email(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  authKey: z.string().min(1),
});

const UpdateMaterialSchema = z.object({
  authKey: z.string().min(1).optional(),
  saltAuth: z.string().min(1).optional(),
  saltEnc: z.string().min(1).optional(),
  kdfParams: KdfParamsSchema.optional(),
  wrappedByPassphrase: SealedSchema.optional(),
  wrappedByRecovery: SealedSchema.optional(),
});

function userMaterial(u: typeof users.$inferSelect) {
  return {
    saltAuth: bufToB64(u.kdfSaltAuth),
    saltEnc: bufToB64(u.kdfSaltEnc),
    kdfParams: u.kdfParams,
    wrappedByPassphrase: {
      iv: bufToB64(u.wrappedByPassphraseIv),
      ciphertext: bufToB64(u.wrappedByPassphraseCt),
    },
    wrappedByRecovery: {
      iv: bufToB64(u.wrappedByRecoveryIv),
      ciphertext: bufToB64(u.wrappedByRecoveryCt),
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  // Public: create a new account.
  app.post('/signup', async (req, reply) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;
    const email = body.email.toLowerCase().trim();

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'Email already in use' });
    }

    const serverSalt = newServerSalt();
    const id = randomUUID();
    const authKeyHash = hashAuthKey(b64ToBuf(body.authKey), serverSalt);

    await db.insert(users).values({
      id,
      email,
      authKeyHash,
      authKeyServerSalt: serverSalt,
      kdfSaltAuth: b64ToBuf(body.saltAuth),
      kdfSaltEnc: b64ToBuf(body.saltEnc),
      kdfParams: body.kdfParams,
      wrappedByPassphraseIv: b64ToBuf(body.wrappedByPassphrase.iv),
      wrappedByPassphraseCt: b64ToBuf(body.wrappedByPassphrase.ciphertext),
      wrappedByRecoveryIv: b64ToBuf(body.wrappedByRecovery.iv),
      wrappedByRecoveryCt: b64ToBuf(body.wrappedByRecovery.ciphertext),
    });

    const token = app.jwt.sign({ sub: id, email });
    return { token, userId: id, email };
  });

  // Public: fetch the salts a client needs to derive its auth key.
  // Returns 404 for unknown emails — this leaks existence; for a private
  // single-operator deployment that's acceptable. Add a constant-time
  // dummy salt for public deployments.
  app.post('/challenge', async (req, reply) => {
    const parsed = ChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const email = parsed.data.email.toLowerCase().trim();
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      return reply.code(404).send({ error: 'Unknown account' });
    }
    return {
      saltAuth: bufToB64(found[0].kdfSaltAuth),
      kdfParams: found[0].kdfParams,
    };
  });

  // Public: verify auth key and issue a JWT + return full key material.
  app.post('/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const email = parsed.data.email.toLowerCase().trim();
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const u = found[0];
    const ok = verifyAuthKey(b64ToBuf(parsed.data.authKey), u.authKeyServerSalt, u.authKeyHash);
    if (!ok) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const token = app.jwt.sign({ sub: u.id, email: u.email });
    return {
      token,
      userId: u.id,
      email: u.email,
      material: userMaterial(u),
    };
  });

  // Stateless logout — the client just discards the token. We keep the route
  // for symmetry / future token blocklisting.
  app.post('/logout', async () => ({ success: true }));

  // Authenticated: fetch the current user's material (used after a token is
  // restored from localStorage so the client can re-derive its keys).
  app.get('/me', { preHandler: app.authenticate }, async (req, reply) => {
    const found = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
    if (found.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }
    const u = found[0];
    return {
      userId: u.id,
      email: u.email,
      material: userMaterial(u),
    };
  });

  // Authenticated: rotate any subset of key material (passphrase change,
  // recovery-code regeneration, KDF param bump). The client recomputes
  // everything locally and sends the resulting fields.
  app.put('/material', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = UpdateMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;
    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (body.authKey) {
      const serverSalt = newServerSalt();
      updates.authKeyServerSalt = serverSalt;
      updates.authKeyHash = hashAuthKey(b64ToBuf(body.authKey), serverSalt);
    }
    if (body.saltAuth) updates.kdfSaltAuth = b64ToBuf(body.saltAuth);
    if (body.saltEnc) updates.kdfSaltEnc = b64ToBuf(body.saltEnc);
    if (body.kdfParams) updates.kdfParams = body.kdfParams;
    if (body.wrappedByPassphrase) {
      updates.wrappedByPassphraseIv = b64ToBuf(body.wrappedByPassphrase.iv);
      updates.wrappedByPassphraseCt = b64ToBuf(body.wrappedByPassphrase.ciphertext);
    }
    if (body.wrappedByRecovery) {
      updates.wrappedByRecoveryIv = b64ToBuf(body.wrappedByRecovery.iv);
      updates.wrappedByRecoveryCt = b64ToBuf(body.wrappedByRecovery.ciphertext);
    }

    await db.update(users).set(updates).where(eq(users.id, req.userId));
    return { success: true };
  });
}
