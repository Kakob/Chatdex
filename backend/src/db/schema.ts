// Backend schema for Chatdex.
//
// Cloud sync is end-to-end encrypted:
//   - Auth: WebAuthn passkey (Touch ID / Face ID / Windows Hello / security key).
//   - Key derivation: PRF extension on the same passkey produces the wrapping
//     key. Server only ever sees the encrypted-at-rest wrap.
//   - Recovery: a 200-bit recovery code shown once at signup. Server stores a
//     hash to gate the recovery flow against email-enumeration DoS.
//
// The server has no domain knowledge of conversations/messages/etc. — those
// live in the generic sync_records table as opaque ciphertext blobs.

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
  integer,
} from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Users table — created when a user opts into cloud sync.
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),

    // WebAuthn passkey credential. Used both as the second factor (auth)
    // and to derive the PRF wrapping key (encryption).
    passkeyCredentialId: text('passkey_credential_id').notNull(),
    passkeyPublicKey: bytea('passkey_public_key').notNull(),
    passkeyCounter: integer('passkey_counter').notNull().default(0),
    passkeyTransports: jsonb('passkey_transports').$type<string[] | null>(),

    // PRF eval salt — sent with each WebAuthn assertion so the authenticator
    // produces the same wrapping-key bytes each time.
    prfSalt: bytea('prf_salt').notNull(),

    // Master key wrapped twice: by the PRF-derived key (normal unlock) and by
    // a key derived from the recovery code (backup).
    wrappedByPasskeyIv: bytea('wrapped_by_passkey_iv').notNull(),
    wrappedByPasskeyCt: bytea('wrapped_by_passkey_ct').notNull(),
    wrappedByRecoveryIv: bytea('wrapped_by_recovery_iv').notNull(),
    wrappedByRecoveryCt: bytea('wrapped_by_recovery_ct').notNull(),

    // SHA-256(serverSalt || recoveryCode). Verified at recovery-init to keep
    // an attacker who only knows the email from triggering account lockout
    // by re-enrolling a passkey.
    recoveryCodeHash: bytea('recovery_code_hash').notNull(),
    recoveryCodeServerSalt: bytea('recovery_code_server_salt').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    uniqueIndex('users_passkey_credential_idx').on(table.passkeyCredentialId),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// One row per encrypted record the client wants to sync. Server treats
// `iv` and `ciphertext` as opaque bytes — only the client can read them.
export const syncRecords = pgTable(
  'sync_records',
  {
    id: text('id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // length 32: 'understanding_project' (21 chars) overflows the original 20.
    kind: varchar('kind', { length: 32 })
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
        | 'finding'
        | 'detector_run'
        | 'understanding_project'
        | 'project_association'
        | 'understanding_object'
        | 'understanding_event'
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
