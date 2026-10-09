import type { Pool } from "pg";
import type { Sql } from "./db.ts";

/** Query runner: `text` with `$n` placeholders + params -> rows. */
export type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` + `.transaction()` `Sql` surface. */
export function toSql(run: Run, transaction: Sql["transaction"]): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  sql.transaction = transaction;
  return sql;
}

/**
 * `Sql` over a node-postgres pool. `transaction` checks out ONE connection and
 * runs BEGIN … COMMIT on it (ROLLBACK on error), so every statement in the
 * callback is atomic and isolated from concurrent callers.
 */
export function createPgSql(pool: Pool): Sql {
  return toSql(
    async <T>(text: string, params: unknown[]) => (await pool.query(text, params)).rows as T[],
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const tx = toSql(
          async <T>(text: string, params: unknown[]) =>
            (await client.query(text, params)).rows as T[],
          () => Promise.reject(new Error("Nested transactions are not supported")),
        );
        const result = await fn(tx);
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
