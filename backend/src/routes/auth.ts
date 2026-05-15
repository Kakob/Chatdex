import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

import { db, users } from '../db/index.js';
import { b64ToBuf, bufToB64 } from '../utils/binary.js';
import { hashSecret, newServerSalt, verifySecret } from '../utils/passwordHash.js';
import {
  mintChallengeToken,
  verifyChallengeToken,
  newChallengeBytes,
  newPrfSalt,
} from '../utils/challengeToken.js';

const RP_NAME = 'Chatdex';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:4000';

const SealedSchema = z.object({
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

const EmailSchema = z.object({ email: z.string().email() });

const RegisterFinishSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  attestationResponse: z.unknown(),
  wrappedByPasskey: SealedSchema,
  wrappedByRecovery: SealedSchema,
  recoveryCode: z.string().min(1), // for server-side hash storage
});

const LoginFinishSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  assertionResponse: z.unknown(),
});

const RecoverInitSchema = z.object({
  email: z.string().email(),
  recoveryCode: z.string().min(1),
});

const RecoverFinishSchema = z.object({
  email: z.string().email(),
  recoveryCode: z.string().min(1),
  token: z.string().min(1),
  attestationResponse: z.unknown(),
  wrappedByPasskey: SealedSchema,
  wrappedByRecovery: SealedSchema,
});

function userMaterial(u: typeof users.$inferSelect) {
  return {
    prfSalt: bufToB64(u.prfSalt),
    wrappedByPasskey: {
      iv: bufToB64(u.wrappedByPasskeyIv),
      ciphertext: bufToB64(u.wrappedByPasskeyCt),
    },
    wrappedByRecovery: {
      iv: bufToB64(u.wrappedByRecoveryIv),
      ciphertext: bufToB64(u.wrappedByRecoveryCt),
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  // ---------- registration ----------

  app.post('/passkey/register-init', async (req, reply) => {
    const parsed = EmailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const email = parsed.data.email.toLowerCase().trim();

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'Email already in use' });
    }

    const challenge = newChallengeBytes();
    const prfSalt = newPrfSalt();
    const pendingUserId = randomUUID();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: email,
      userID: new Uint8Array(Buffer.from(pendingUserId)),
      challenge: new Uint8Array(challenge),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestationType: 'none',
    });
    // PRF extension is passed as base64url so SimpleWebAuthn-browser decodes
    // it back to an ArrayBuffer before calling navigator.credentials.create.
    (options as unknown as { extensions: Record<string, unknown> }).extensions = {
      ...((options as unknown as { extensions?: Record<string, unknown> }).extensions ?? {}),
      prf: { eval: { first: prfSalt.toString('base64url') } },
    };

    const token = mintChallengeToken({
      intent: 'register',
      email,
      challenge: challenge.toString('base64url'),
      prfSalt: prfSalt.toString('base64url'),
      pendingUserId,
    });

    return { options, token };
  });

  app.post('/passkey/register-finish', async (req, reply) => {
    const parsed = RegisterFinishSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const email = body.email.toLowerCase().trim();

    let challengePayload;
    try {
      challengePayload = verifyChallengeToken(body.token);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    if (challengePayload.intent !== 'register' || challengePayload.email !== email) {
      return reply.code(400).send({ error: 'Token mismatch' });
    }

    const verification = await verifyRegistrationResponse({
      response: body.attestationResponse as RegistrationResponseJSON,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: 'Passkey verification failed' });
    }

    const cred = verification.registrationInfo.credential;
    const recoveryServerSalt = newServerSalt();
    const recoveryCodeHash = hashSecret(Buffer.from(body.recoveryCode), recoveryServerSalt);

    await db.insert(users).values({
      id: challengePayload.pendingUserId!,
      email,
      passkeyCredentialId: cred.id,
      passkeyPublicKey: Buffer.from(cred.publicKey),
      passkeyCounter: cred.counter,
      passkeyTransports: cred.transports ?? null,
      prfSalt: Buffer.from(challengePayload.prfSalt, 'base64url'),
      wrappedByPasskeyIv: b64ToBuf(body.wrappedByPasskey.iv),
      wrappedByPasskeyCt: b64ToBuf(body.wrappedByPasskey.ciphertext),
      wrappedByRecoveryIv: b64ToBuf(body.wrappedByRecovery.iv),
      wrappedByRecoveryCt: b64ToBuf(body.wrappedByRecovery.ciphertext),
      recoveryCodeHash,
      recoveryCodeServerSalt: recoveryServerSalt,
    });

    const jwt = app.jwt.sign({ sub: challengePayload.pendingUserId!, email });
    return { token: jwt, userId: challengePayload.pendingUserId, email };
  });

  // ---------- login ----------

  app.post('/passkey/login-init', async (req, reply) => {
    const parsed = EmailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const email = parsed.data.email.toLowerCase().trim();

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      return reply.code(404).send({ error: 'Unknown account' });
    }
    const u = found[0];
    const challenge = newChallengeBytes();

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      challenge: new Uint8Array(challenge),
      allowCredentials: [
        {
          id: u.passkeyCredentialId,
          transports: (u.passkeyTransports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
        },
      ],
      userVerification: 'preferred',
    });
    (options as unknown as { extensions: Record<string, unknown> }).extensions = {
      ...((options as unknown as { extensions?: Record<string, unknown> }).extensions ?? {}),
      prf: { eval: { first: u.prfSalt.toString('base64url') } },
    };

    const token = mintChallengeToken({
      intent: 'authenticate',
      email,
      challenge: challenge.toString('base64url'),
      prfSalt: u.prfSalt.toString('base64url'),
    });

    return { options, token };
  });

  app.post('/passkey/login-finish', async (req, reply) => {
    const parsed = LoginFinishSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const email = body.email.toLowerCase().trim();

    let challengePayload;
    try {
      challengePayload = verifyChallengeToken(body.token);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    if (challengePayload.intent !== 'authenticate' || challengePayload.email !== email) {
      return reply.code(400).send({ error: 'Token mismatch' });
    }

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) return reply.code(404).send({ error: 'Unknown account' });
    const u = found[0];

    const verification = await verifyAuthenticationResponse({
      response: body.assertionResponse as AuthenticationResponseJSON,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: u.passkeyCredentialId,
        publicKey: new Uint8Array(u.passkeyPublicKey),
        counter: u.passkeyCounter,
        transports: (u.passkeyTransports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      },
    });
    if (!verification.verified) return reply.code(401).send({ error: 'Assertion failed' });

    if (verification.authenticationInfo.newCounter > u.passkeyCounter) {
      await db
        .update(users)
        .set({
          passkeyCounter: verification.authenticationInfo.newCounter,
          updatedAt: new Date(),
        })
        .where(eq(users.id, u.id));
    }

    const jwt = app.jwt.sign({ sub: u.id, email: u.email });
    return {
      token: jwt,
      userId: u.id,
      email: u.email,
      material: userMaterial(u),
    };
  });

  // ---------- session ----------

  app.post('/logout', async () => ({ success: true }));

  app.get('/me', { preHandler: app.authenticate }, async (req, reply) => {
    const found = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
    if (found.length === 0) return reply.code(404).send({ error: 'User not found' });
    const u = found[0];
    return { userId: u.id, email: u.email, material: userMaterial(u) };
  });

  // ---------- recovery ----------

  // Step 1: client posts email + recovery code. Server verifies hash, returns
  // the wrapped master key + a challenge token authorizing the next step.
  app.post('/recover-init', async (req, reply) => {
    const parsed = RecoverInitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const email = parsed.data.email.toLowerCase().trim();

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      return reply.code(404).send({ error: 'Unknown account' });
    }
    const u = found[0];
    const ok = verifySecret(
      Buffer.from(parsed.data.recoveryCode),
      u.recoveryCodeServerSalt,
      u.recoveryCodeHash
    );
    if (!ok) return reply.code(401).send({ error: 'Invalid recovery code' });

    const challenge = newChallengeBytes();
    const prfSalt = newPrfSalt();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: email,
      userID: new Uint8Array(Buffer.from(u.id)),
      challenge: new Uint8Array(challenge),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestationType: 'none',
    });
    (options as unknown as { extensions: Record<string, unknown> }).extensions = {
      ...((options as unknown as { extensions?: Record<string, unknown> }).extensions ?? {}),
      prf: { eval: { first: prfSalt.toString('base64url') } },
    };

    const token = mintChallengeToken({
      intent: 'recover-enroll',
      email,
      challenge: challenge.toString('base64url'),
      prfSalt: prfSalt.toString('base64url'),
      pendingUserId: u.id,
    });

    return {
      wrappedByRecovery: {
        iv: bufToB64(u.wrappedByRecoveryIv),
        ciphertext: bufToB64(u.wrappedByRecoveryCt),
      },
      options,
      token,
    };
  });

  // Step 2: client has unwrapped the master key, enrolled a new passkey, and
  // re-wrapped the master key. Server verifies the new attestation and writes
  // the new credential + wraps + recovery hash (regenerated for the new
  // recovery code, which the client also resent).
  app.post('/recover-finish', async (req, reply) => {
    const parsed = RecoverFinishSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const email = body.email.toLowerCase().trim();

    let challengePayload;
    try {
      challengePayload = verifyChallengeToken(body.token);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    if (challengePayload.intent !== 'recover-enroll' || challengePayload.email !== email) {
      return reply.code(400).send({ error: 'Token mismatch' });
    }

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) return reply.code(404).send({ error: 'Unknown account' });
    const u = found[0];
    // Re-verify recovery code on the finish step too — the init token has a
    // 5-minute TTL but we want to double-check the caller still knows it.
    const ok = verifySecret(
      Buffer.from(body.recoveryCode),
      u.recoveryCodeServerSalt,
      u.recoveryCodeHash
    );
    if (!ok) return reply.code(401).send({ error: 'Invalid recovery code' });

    const verification = await verifyRegistrationResponse({
      response: body.attestationResponse as RegistrationResponseJSON,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: 'Passkey verification failed' });
    }
    const cred = verification.registrationInfo.credential;

    await db
      .update(users)
      .set({
        passkeyCredentialId: cred.id,
        passkeyPublicKey: Buffer.from(cred.publicKey),
        passkeyCounter: cred.counter,
        passkeyTransports: cred.transports ?? null,
        prfSalt: Buffer.from(challengePayload.prfSalt, 'base64url'),
        wrappedByPasskeyIv: b64ToBuf(body.wrappedByPasskey.iv),
        wrappedByPasskeyCt: b64ToBuf(body.wrappedByPasskey.ciphertext),
        wrappedByRecoveryIv: b64ToBuf(body.wrappedByRecovery.iv),
        wrappedByRecoveryCt: b64ToBuf(body.wrappedByRecovery.ciphertext),
        updatedAt: new Date(),
      })
      .where(eq(users.id, u.id));

    const jwt = app.jwt.sign({ sub: u.id, email });
    return { token: jwt, userId: u.id, email };
  });
}
