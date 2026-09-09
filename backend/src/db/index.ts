import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * The database handle routes are written against. Deliberately the driver-
 * agnostic Drizzle type so the same routes run on postgres-js in production
 * and on an in-process PGlite database under test (src/test/harness.ts).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://claude_utils:dev_password@localhost:5432/claude_utils';

/** The production handle. postgres-js connects lazily on first query. */
export const db: Db = drizzle(postgres(connectionString), { schema });

// Export schema for use in routes
export * from './schema.js';
