// Backend test harness: an in-process Postgres (PGlite) migrated from the
// checked-in migrations, the real Fastify app built without listening, and
// a log capture so tests can assert what never reaches the logs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import * as schema from '../db/schema.js';
import type { Db } from '../db/index.js';
import { buildApp } from '../app.js';
import { hashSecret, newServerSalt } from '../utils/passwordHash.js';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle/migrations',
);

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Everything Fastify/pino writes, at trace level, as raw lines. */
export class LogCapture {
  lines: string[] = [];
  write(msg: string): void {
    this.lines.push(msg);
  }
  text(): string {
    return this.lines.join('');
  }
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  logs: LogCapture;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const { db, close } = await createTestDb();
  const logs = new LogCapture();
  const app = await buildApp({ db, logger: { level: 'trace', stream: logs } });
  await app.ready();
  return {
    app,
    db,
    logs,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

export function bearer(app: FastifyInstance, userId: string, email = `${userId}@example.com`): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email })}`;
}

export interface SeededUser {
  id: string;
  email: string;
  recoveryCode: string;
  row: typeof schema.users.$inferSelect;
}

/** Insert a fully enrolled user with random key material and a known recovery code. */
export async function seedUser(
  db: Db,
  overrides: { email?: string; recoveryCode?: string; passkeyCounter?: number } = {},
): Promise<SeededUser> {
  const id = randomUUID();
  const email = overrides.email ?? `${id}@example.com`;
  const recoveryCode = overrides.recoveryCode ?? 'ABCDE-FGHIJ-KLMNO-PQRST';
  const salt = newServerSalt();
  await db.insert(schema.users).values({
    id,
    email,
    passkeyCredentialId: `cred-${id}`,
    passkeyPublicKey: randomBytes(65),
    passkeyCounter: overrides.passkeyCounter ?? 0,
    passkeyTransports: ['internal'],
    prfSalt: randomBytes(32),
    wrappedByPasskeyIv: randomBytes(12),
    wrappedByPasskeyCt: randomBytes(48),
    wrappedByRecoveryIv: randomBytes(12),
    wrappedByRecoveryCt: randomBytes(48),
    recoveryCodeHash: hashSecret(Buffer.from(recoveryCode), salt),
    recoveryCodeServerSalt: salt,
  });
  const [row] = await db.select().from(schema.users).where((await import('drizzle-orm')).eq(schema.users.id, id));
  return { id, email, recoveryCode, row };
}

export function b64(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}
