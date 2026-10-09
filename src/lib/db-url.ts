/**
 * The Postgres connection string for the current runtime, or `undefined`.
 *
 * Order: `DATABASE_URL` (any Postgres; explicit wins) -> `NETLIFY_DB_URL`
 * (injected by Netlify Database; in a Netlify Function it may only be visible
 * through the `Netlify.env` runtime global, which is what `@netlify/database`'s
 * `getConnectionString()` reads too). Empty / whitespace values count as unset.
 * Server-only; safe to import from other server modules.
 */
export function resolveDatabaseUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const nfEnv = (globalThis as { Netlify?: { env?: { get(key: string): string | undefined } } })
    .Netlify?.env;
  const candidates = [
    process.env.DATABASE_URL,
    process.env.NETLIFY_DB_URL,
    nfEnv?.get("DATABASE_URL"),
    nfEnv?.get("NETLIFY_DB_URL"),
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
