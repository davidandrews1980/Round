// Run with the local Postgres (default postgres://rt@localhost:5544/roundtable_test,
// override with SEATS_TEST_DATABASE_URL). Skipped if that database is unreachable.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPgSql } from "../pg-sql.ts";
import { createSaveQueue } from "../save-queue.ts";
import { replaceSeats, type SeatValues } from "./seats-store.ts";
import type { Sql } from "../db.ts";

const url = process.env.SEATS_TEST_DATABASE_URL ?? "postgres://rt@localhost:5544/roundtable_test";
const PROVIDERS = ["xai", "openai", "anthropic", "google", "deepseek", "groq"];
const KEYS = ["caution", "creativity", "openness", "confidence", "empathy", "directness"] as const;

const pool = new pg.Pool({ connectionString: url, max: 12 });
let sql: Sql;
let available = true;
const userId = `seats-test-${Date.now()}`;
let tableId = 0;

function seat(providerId: string, patch: Partial<SeatValues> = {}): SeatValues {
  return {
    providerId, jobTitle: "", job: "", personality: "",
    caution: 50, creativity: 50, openness: 50, confidence: 50, empathy: 50, directness: 50,
    ...patch,
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newTable(): Promise<number> {
  const [t] = await sql<{ id: number }>`insert into tables (user_id) values (${userId}) returning id`;
  return t.id;
}
async function readSeats(id: number) {
  return sql<Record<string, number | string>>`
    select id, provider_id, caution, creativity, openness, confidence, empathy, directness, sort_order
    from seats where table_id = ${id} order by sort_order`;
}

describe("replaceSeats (Postgres)", { concurrency: false }, () => {
  before(async () => {
    try {
      sql = createPgSql(pool);
      await sql`select 1`;
    } catch (err) {
      available = false;
      console.warn(`seats-store tests skipped: cannot reach ${url} (${(err as Error).message})`);
    }
  });
  after(async () => {
    if (available) await sql`delete from tables where user_id = ${userId}`;
    await pool.end();
  });

  it("six rapid slider updates through the client queue all persist after reload", async (t) => {
    if (!available) return t.skip("no database");
    tableId = await newTable();
    assert.equal(await replaceSeats(sql, userId, tableId, PROVIDERS.map((p) => seat(p))), true);
    const [seatBefore] = await readSeats(tableId);

    // Simulates the page: each slider release saves the WHOLE seat list; saves go
    // through the serialized queue; server latency is random so naive parallel
    // requests would land out of order.
    const queue = createSaveQueue<SeatValues[]>(async (seats) => {
      await sleep(Math.random() * 30);
      await replaceSeats(sql, userId, tableId, seats);
    });
    let draft = PROVIDERS.map((p) => seat(p));
    const target = [10, 25, 40, 55, 70, 85];
    const saves: Promise<void>[] = [];
    for (let i = 0; i < 6; i++) {
      draft = draft.map((s, idx) => (idx === 0 ? { ...s, [KEYS[i]]: target[i] } : s));
      saves.push(queue.enqueue(draft));
      await sleep(Math.random() * 5); // "rapid": faster than a save round-trip
    }
    await Promise.all(saves);

    const rows = await readSeats(tableId); // a fresh read = reload
    assert.equal(rows.length, 6);
    assert.deepEqual(KEYS.map((k) => rows[0][k]), target);
    assert.equal(rows[0].id, seatBefore.id, "seat updated in place (id is stable)");
  });

  it("many fully concurrent saves never interleave, lose or duplicate seats", async (t) => {
    if (!available) return t.skip("no database");
    tableId = await newTable();
    await replaceSeats(sql, userId, tableId, PROVIDERS.map((p) => seat(p)));
    const idsBefore = (await readSeats(tableId)).map((r) => r.id);

    // 40 simultaneous saves, each a different complete snapshot (all six sliders = n on every seat).
    const snapshots = Array.from({ length: 40 }, (_, n) =>
      PROVIDERS.map((p) => seat(p, Object.fromEntries(KEYS.map((k) => [k, n])))),
    );
    await Promise.all(snapshots.map((s) => replaceSeats(sql, userId, tableId, s)));

    const rows = await readSeats(tableId);
    assert.equal(rows.length, 6, "exactly six seats, no duplicates");
    assert.deepEqual(rows.map((r) => r.id), idsBefore, "same seat ids");
    const winner = rows[0].caution;
    for (const r of rows) for (const k of KEYS) assert.equal(r[k], winner, "all values come from ONE snapshot");
  });

  it("adds, removes and reorders seats; cleans duplicates; rejects foreign tables", async (t) => {
    if (!available) return t.skip("no database");
    tableId = await newTable();
    await replaceSeats(sql, userId, tableId, [seat("xai"), seat("openai")]);
    await replaceSeats(sql, userId, tableId, [seat("openai", { caution: 7 }), seat("groq")]);
    let rows = await readSeats(tableId);
    assert.deepEqual(rows.map((r) => r.provider_id), ["openai", "groq"]);
    assert.equal(rows[0].caution, 7);

    // a duplicate left over from the old racy implementation is collapsed
    await sql`insert into seats (table_id, user_id, provider_id, role) values (${tableId}, ${userId}, 'groq', 'cast')`;
    await replaceSeats(sql, userId, tableId, [seat("groq", { empathy: 3 })]);
    rows = await readSeats(tableId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].empathy, 3);

    assert.equal(await replaceSeats(sql, "someone-else", tableId, [seat("xai")]), false);
    assert.equal((await readSeats(tableId)).length, 1, "foreign save changed nothing");
  });

  it("rolls back entirely when a statement fails mid-way", async (t) => {
    if (!available) return t.skip("no database");
    tableId = await newTable();
    await replaceSeats(sql, userId, tableId, [seat("xai", { caution: 11 }), seat("openai")]);
    await assert.rejects(
      replaceSeats(sql, userId, tableId, [seat("xai", { caution: 99 }), seat("google", { jobTitle: null as unknown as string })]),
    );
    const rows = await readSeats(tableId);
    assert.deepEqual(rows.map((r) => [r.provider_id, r.caution]), [["xai", 11], ["openai", 50]]);
  });
});

describe("createSaveQueue", () => {
  it("sends one at a time, in order, newest pending wins", async () => {
    const sent: number[] = [];
    let active = 0;
    let maxActive = 0;
    const q = createSaveQueue<number>(async (n) => {
      active++; maxActive = Math.max(maxActive, active);
      await sleep(10);
      sent.push(n);
      active--;
    });
    const ps = [1, 2, 3, 4, 5, 6].map((n) => q.enqueue(n));
    await Promise.all(ps);
    assert.equal(maxActive, 1);
    assert.equal(sent[0], 1);
    assert.equal(sent.at(-1), 6, "last write wins");
    assert.deepEqual(sent, [...sent].sort((a, b) => a - b), "never out of order");
  });
  it("a failed save rejects its waiters but later saves still go out", async () => {
    let n = 0;
    const q = createSaveQueue<number>(async (v) => {
      await sleep(5);
      if (n++ === 0) throw new Error("boom");
      void v;
    });
    const first = q.enqueue(1);
    const second = q.enqueue(2);
    await assert.rejects(first, /boom/);
    await second;
    await q.flush();
  });
});
