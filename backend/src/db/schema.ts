// Backend schema for Chatdex.
//
// Cloud sync is end-to-end encrypted: the backend only stores opaque ciphertext
// blobs scoped to a user. There are no domain tables (conversations, messages,
// anchors, etc.) anymore — IndexedDB on the client is the source of truth, and
// the server is a replication backplane that cannot read user content.

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  primaryKey,
  uniqueIndex,
  customType,
  boolean,
  varchar,
} from 'drizzle-orm/pg-core';

// bytea custom type — Drizzle's stock pg-core doesn't expose one.
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export type KdfParamsRow = {
  algorithm: 'argon2id';
  iterations: number;
  memoryKiB: number;
  parallelism: number;
  hashBytes: number;
};

// Users table — created when a user opts into cloud sync.
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    authKeyHash: bytea('auth_key_hash').notNull(),
    authKeyServerSalt: bytea('auth_key_server_salt').notNull(),
    kdfSaltAuth: bytea('kdf_salt_auth').notNull(),
    kdfSaltEnc: bytea('kdf_salt_enc').notNull(),
    kdfParams: jsonb('kdf_params').$type<KdfParamsRow>().notNull(),
    wrappedByPassphraseIv: bytea('wrapped_by_passphrase_iv').notNull(),
    wrappedByPassphraseCt: bytea('wrapped_by_passphrase_ct').notNull(),
    wrappedByRecoveryIv: bytea('wrapped_by_recovery_iv').notNull(),
    wrappedByRecoveryCt: bytea('wrapped_by_recovery_ct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// One row per encrypted record the client wants to sync. The server treats
// `iv` and `ciphertext` as opaque bytes — only the client can read them.
//
// Composite PK (user_id, id) lets the same client-generated UUID exist across
// users without collision. `kind` and `parent_id` are kept in plaintext to let
// the client request, e.g. "all messages for conversation X" without decrypting
// the whole vault. They are *not* secret — leaking them only reveals counts and
// shape, not content.
export const syncRecords = pgTable(
  'sync_records',
  {
    id: text('id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 })
      .notNull()
      .$type<
        | 'conversation'
        | 'message'
        | 'activity'
        | 'anchor'
        | 'tag'
        | 'entity_tag'
        | 'folder'
        | 'daily_stats'
        | 'metadata'
      >(),
    parentId: text('parent_id'),
    iv: bytea('iv').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deleted: boolean('deleted').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('sync_records_user_updated_idx').on(table.userId, table.updatedAt),
    index('sync_records_user_kind_updated_idx').on(table.userId, table.kind, table.updatedAt),
    index('sync_records_user_parent_idx').on(table.userId, table.parentId),
  ]
);

export type SyncRecord = typeof syncRecords.$inferSelect;
export type NewSyncRecord = typeof syncRecords.$inferInsert;
