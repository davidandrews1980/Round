/**
 * Self-hosted Better Auth for THIS app (server-only): email + password.
 *
 * The app runs its own Better Auth at `/api/auth/*`, so the session cookie stays
 * on this app's own origin. Users and sessions persist in the same Postgres as
 * the app data (`DATABASE_URL`, or Netlify Database's `NETLIFY_DB_URL`); with neither it falls back to the
 * embedded PGLite database (local dev only, wiped on restart).
 *
 * Env:
 *   - BETTER_AUTH_SECRET  signing secret (required in production)
 *   - BETTER_AUTH_URL     public origin, e.g. https://a.pathwaydevs.me
 *   - VITE_AUTH_ENABLED   "false" turns auth off (dev user, no database only)
 *
 * NEVER import this from client code — it pulls in `pg` + server-only Better
 * Auth internals. The client uses `@/lib/auth/client`; components read the user
 * via `@/lib/auth/use-current-user`; server functions get a verified id via
 * `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { pgliteDialect } from "./pglite-dialect";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/**
 * Dev-only fallback signing secret, process-stable on globalThis so HMR does not
 * invalidate sessions. Production MUST set BETTER_AUTH_SECRET (it is required
 * below when NODE_ENV=production).
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __rtAuthDevSecret__?: string;
};
function devAuthSecret(): string {
  globalAuthRef.__rtAuthDevSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__rtAuthDevSecret__;
}

// Explicit off-switch: `VITE_AUTH_ENABLED=false` forces the dev user.
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

/** True when sign-in is active (real auth is enforced). */
export const authConfigured = !authDisabled && emailAndPasswordEnabled;

const explicitBaseURL = env("BETTER_AUTH_URL");
const secret = env("BETTER_AUTH_SECRET");
if (!secret && process.env.NODE_ENV === "production") {
  throw new Error(
    "BETTER_AUTH_SECRET is required in production (set it in the Netlify site env).",
  );
}

// Local `npm run dev` (port 8080) / `npm run preview` (8081). Browsers may send
// Origin as any of these loopback spellings for the same server.
const LOCAL_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
];
const LOCAL_HOSTS = ["localhost:8080", "127.0.0.1:8080", "[::1]:8080", "localhost:8081", "127.0.0.1:8081"];

// With BETTER_AUTH_URL set the base URL is fixed (production). Without it Better
// Auth derives the origin per-request from the Host header, limited to loopback.
const baseURL = explicitBaseURL ?? {
  allowedHosts: LOCAL_HOSTS,
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs. Production trusts only
// BETTER_AUTH_URL (plus loopback, which cannot be reached from a victim's
// browser against the deployed host anyway).
const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...LOCAL_ORIGINS]
  : LOCAL_ORIGINS;

const databaseUrl = env("DATABASE_URL") ?? env("NETLIFY_DB_URL");

// Real Postgres when `DATABASE_URL` is set, else the embedded PGLite (local dev)
// via a Kysely dialect. Both use the Better Auth schema from migrations/0001_auth.sql.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/**
 * Session token cookie name. `__Host-` makes the browser refuse a same-named
 * cookie carrying a Domain attribute; app-specific prefix keeps this app's
 * cookies distinct from any other app on the same host.
 */
export const SESSION_TOKEN_COOKIE = "__Host-roundtable.session_token";

export const auth = betterAuth({
  baseURL,
  secret: secret ?? devAuthSecret(),
  database,
  trustedOrigins,

  // No `session_data` cookie cache: every read hits the database, so a sign-out
  // takes effect immediately, and sign-in sets exactly one cookie (the local
  // `vite dev` / `vite preview` Node bridge keeps only the LAST Set-Cookie of a
  // response; the Netlify function runtime does not have that problem).

  emailAndPassword: {
    enabled: emailAndPasswordEnabled,
    minPasswordLength: 8,
    // No email provider is configured, so there is no verification mail.
    requireEmailVerification: false,
  },

  advanced: {
    // Netlify forwards the real client IP in `x-nf-client-connection-ip`; Better
    // Auth's rate limiter keys on it (else every visitor shares one bucket).
    ipAddress: { ipAddressHeaders: ["x-nf-client-connection-ip", "x-forwarded-for"] },
    useSecureCookies: false,
    // Browsers accept Secure cookies on http://localhost, so local dev works.
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-roundtable.session_data" },
      account_data: { name: "__Host-roundtable.account_data" },
      dont_remember: { name: "__Host-roundtable.dont_remember" },
    },
  },

  plugins: [
    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}
