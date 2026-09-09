// Ciphertext-only sync (CLAUDE.md invariant 1) at the route boundary:
// user scoping, last-write-wins by updatedAt, and an envelope that carries
// nothing but routing metadata and opaque bytes.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { syncRecords } from '../db/schema.js';
import { b64, bearer, createTestApp, seedUser, type TestApp } from '../test/harness.js';

const MARKER = 'PLAINTEXT-THAT-MUST-NOT-LAND-51c2';

let t: TestApp;
let alice: { id: string; auth: string };
let bob: { id: string; auth: string };

beforeAll(async () => {
  t = await createTestApp();
  const a = await seedUser(t.db);
  const b = await seedUser(t.db);
  alice = { id: a.id, auth: bearer(t.app, a.id, a.email) };
  bob = { id: b.id, auth: bearer(t.app, b.id, b.email) };
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.db.delete(syncRecords);
});

function rec(id: string, updatedAt: string, extra: Record<string, unknown> = {}) {
  return { id, kind: 'conversation', parentId: null, iv: b64(12), ciphertext: b64(40), updatedAt, ...extra };
}

async function push(auth: string, records: unknown[]) {
  return t.app.inject({ method: 'POST', url: '/api/sync/push', headers: { authorization: auth }, payload: { records } });
}
async function pull(auth: string, query = '') {
  return t.app.inject({ method: 'GET', url: `/api/sync/pull${query}`, headers: { authorization: auth } });
}

describe('user scoping (architecture.md: every read/write scoped to the JWT user)', () => {
  it('two users can hold the same record id and each pulls only their own', async () => {
    expect((await push(alice.auth, [rec('shared-id', '2026-09-09T10:00:00.000Z')])).json()).toMatchObject({ accepted: 1 });
    expect((await push(bob.auth, [rec('shared-id', '2026-09-09T10:00:00.000Z')])).json()).toMatchObject({ accepted: 1 });

    const a = (await pull(alice.auth)).json();
    const b = (await pull(bob.auth)).json();
    expect(a.records).toHaveLength(1);
    expect(b.records).toHaveLength(1);
    expect(a.records[0].ciphertext).not.toBe(b.records[0].ciphertext);

    const rows = await t.db.select().from(syncRecords);
    expect(rows.map((r) => r.userId).sort()).toEqual([alice.id, bob.id].sort());
  });

  it("one user's push cannot overwrite the other's row with the same id", async () => {
    await push(alice.auth, [rec('x', '2026-09-09T10:00:00.000Z')]);
    const [before] = await t.db.select().from(syncRecords).where(eq(syncRecords.userId, alice.id));
    await push(bob.auth, [rec('x', '2026-09-09T11:00:00.000Z')]);
    const [after] = await t.db.select().from(syncRecords).where(eq(syncRecords.userId, alice.id));
    expect(after.ciphertext.equals(before.ciphertext)).toBe(true);
    expect(after.updatedAt.toISOString()).toBe('2026-09-09T10:00:00.000Z');
  });

  it('DELETE /all wipes only the caller', async () => {
    await push(alice.auth, [rec('a1', '2026-09-09T10:00:00.000Z')]);
    await push(bob.auth, [rec('b1', '2026-09-09T10:00:00.000Z')]);
    expect((await t.app.inject({ method: 'DELETE', url: '/api/sync/all', headers: { authorization: alice.auth } })).statusCode).toBe(200);
    expect((await pull(alice.auth)).json().records).toHaveLength(0);
    expect((await pull(bob.auth)).json().records).toHaveLength(1);
  });

  it('rejects unauthenticated push, pull, and delete', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/sync/push', payload: { records: [] } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/sync/pull' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'DELETE', url: '/api/sync/all' })).statusCode).toBe(401);
  });
});

describe('last-write-wins by updatedAt (architecture.md §Backend)', () => {
  it('skips an older or equal write and applies a newer one', async () => {
    const first = rec('lww', '2026-09-09T10:00:00.000Z');
    await push(alice.auth, [first]);

    const older = await push(alice.auth, [rec('lww', '2026-09-09T09:59:59.999Z')]);
    expect(older.json().accepted).toBe(0);
    const equal = await push(alice.auth, [rec('lww', '2026-09-09T10:00:00.000Z')]);
    expect(equal.json().accepted).toBe(0);
    let [row] = await t.db.select().from(syncRecords).where(eq(syncRecords.id, 'lww'));
    expect(row.ciphertext.toString('base64')).toBe(first.ciphertext);

    const newer = rec('lww', '2026-09-09T10:00:00.001Z', { deleted: true });
    expect((await push(alice.auth, [newer])).json().accepted).toBe(1);
    [row] = await t.db.select().from(syncRecords).where(eq(syncRecords.id, 'lww'));
    expect(row.ciphertext.toString('base64')).toBe(newer.ciphertext);
    expect(row.deleted).toBe(true);
  });

  it('paginates pulls by updatedAt with a resumable cursor', async () => {
    await push(alice.auth, [
      rec('p1', '2026-09-09T10:00:01.000Z'),
      rec('p2', '2026-09-09T10:00:02.000Z'),
      rec('p3', '2026-09-09T10:00:03.000Z'),
    ]);
    const page1 = (await pull(alice.auth, '?limit=2')).json();
    expect(page1.records.map((r: { id: string }) => r.id)).toEqual(['p1', 'p2']);
    expect(page1.hasMore).toBe(true);
    const page2 = (await pull(alice.auth, `?limit=2&since=${encodeURIComponent(page1.cursor)}`)).json();
    expect(page2.records.map((r: { id: string }) => r.id)).toEqual(['p3']);
    expect(page2.hasMore).toBe(false);
  });
});

describe('the envelope is routing metadata plus opaque bytes (invariant 1)', () => {
  it('drops any field beyond the schema so plaintext never lands, is never returned, and is never logged', async () => {
    const res = await push(alice.auth, [
      rec('env', '2026-09-09T10:00:00.000Z', { plaintext: MARKER, title: MARKER, payload: { text: MARKER } }),
    ]);
    expect(res.statusCode).toBe(200);
    const pulled = await pull(alice.auth);
    expect(Object.keys(pulled.json().records[0]).sort()).toEqual(
      ['ciphertext', 'deleted', 'id', 'iv', 'kind', 'parentId', 'updatedAt'].sort(),
    );
    expect(pulled.body).not.toContain(MARKER);
    const [row] = await t.db.select().from(syncRecords).where(eq(syncRecords.id, 'env'));
    expect(JSON.stringify(row)).not.toContain(MARKER);
    expect(t.logs.text()).not.toContain(MARKER);
  });

  it('rejects a record without iv or ciphertext, or with an unknown kind', async () => {
    for (const bad of [
      { ...rec('b', '2026-09-09T10:00:00.000Z'), iv: '' },
      { ...rec('b', '2026-09-09T10:00:00.000Z'), ciphertext: undefined },
      { ...rec('b', '2026-09-09T10:00:00.000Z'), kind: 'plaintext_note' },
    ]) {
      expect((await push(alice.auth, [bad])).statusCode).toBe(400);
    }
    expect(await t.db.select().from(syncRecords)).toHaveLength(0);
  });

  it('stores the longest kind names (the varchar(32) migration)', async () => {
    const res = await push(alice.auth, [rec('k', '2026-09-09T10:00:00.000Z', { kind: 'understanding_project' })]);
    expect(res.json().accepted).toBe(1);
    expect((await pull(alice.auth)).json().records[0].kind).toBe('understanding_project');
  });

  it('caps a push batch at 1000 records', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => rec(`m${i}`, '2026-09-09T10:00:00.000Z'));
    expect((await push(alice.auth, many)).statusCode).toBe(400);
  });
});
