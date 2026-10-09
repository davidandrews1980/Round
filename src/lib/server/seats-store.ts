import type { Sql } from "../db.ts";

export type SeatValues = {
  providerId: string;
  jobTitle: string;
  job: string;
  personality: string;
  caution: number;
  creativity: number;
  openness: number;
  confidence: number;
  empathy: number;
  directness: number;
};

/**
 * Atomically replace a table's seat list with `seats` (already validated:
 * 1–6 entries, unique providerId, clamped sliders).
 *
 * One transaction. The table row is locked `FOR UPDATE` first, so concurrent
 * saves for the same table run strictly one after another (never interleaved)
 * and each sees a consistent snapshot. Seats are updated IN PLACE, keyed by
 * (table, provider) — a seat keeps its id across saves — new providers are
 * inserted and removed ones deleted. Returns false if the table isn't the
 * user's.
 */
export async function replaceSeats(
  sql: Sql,
  userId: string,
  tableId: number,
  seats: SeatValues[],
): Promise<boolean> {
  return sql.transaction(async (tx) => {
    const owned = await tx<{ id: number }>`
      select id from tables where id = ${tableId} and user_id = ${userId} for update
    `;
    if (!owned[0]) return false;

    const existing = await tx<{ id: number; provider_id: string }>`
      select id, provider_id from seats
      where table_id = ${tableId} and user_id = ${userId} order by id
    `;
    // First seat per provider wins; any duplicates (from older racy saves) are removed below.
    const byProvider = new Map<string, number>();
    for (const row of existing) if (!byProvider.has(row.provider_id)) byProvider.set(row.provider_id, row.id);

    const keep: number[] = [];
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const id = byProvider.get(s.providerId);
      if (id !== undefined) {
        await tx`
          update seats set
            instruction = ${s.job}, job = ${s.job}, personality = ${s.personality}, job_title = ${s.jobTitle},
            caution = ${s.caution}, creativity = ${s.creativity}, openness = ${s.openness},
            confidence = ${s.confidence}, empathy = ${s.empathy}, directness = ${s.directness},
            sort_order = ${i}
          where id = ${id}
        `;
        keep.push(id);
      } else {
        const [row] = await tx<{ id: number }>`
          insert into seats (
            table_id, user_id, provider_id, role, instruction, job, personality, job_title,
            caution, creativity, openness, confidence, empathy, directness, sort_order
          ) values (
            ${tableId}, ${userId}, ${s.providerId}, ${"cast"}, ${s.job}, ${s.job}, ${s.personality}, ${s.jobTitle},
            ${s.caution}, ${s.creativity}, ${s.openness}, ${s.confidence}, ${s.empathy}, ${s.directness}, ${i}
          ) returning id
        `;
        keep.push(row.id);
      }
    }
    await tx`
      delete from seats
      where table_id = ${tableId} and user_id = ${userId} and not (id = any(${keep}::int[]))
    `;
    return true;
  });
}
