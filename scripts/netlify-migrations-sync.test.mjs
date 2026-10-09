// netlify/database/migrations/ (applied by the Netlify platform) must stay a
// byte-for-byte copy of migrations/*.sql (applied by scripts/migrate.mjs and
// the PGLite fallback). Add new migrations to both.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = (dir) =>
  readdirSync(join(root, dir)).filter((f) => f.endsWith(".sql")).sort();

test("netlify/database/migrations mirrors migrations/", () => {
  const a = sql("migrations");
  const b = sql("netlify/database/migrations");
  assert.deepEqual(b, a);
  for (const f of a) {
    assert.equal(
      readFileSync(join(root, "netlify/database/migrations", f), "utf8"),
      readFileSync(join(root, "migrations", f), "utf8"),
      f,
    );
  }
  for (const f of b) assert.match(f, /^\d+_[a-z0-9_-]+\.sql$/);
});
