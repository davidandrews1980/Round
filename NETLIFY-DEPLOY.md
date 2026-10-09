# Deploying Round Table to Netlify

Stack: TanStack Start + Nitro (`netlify` preset) + Postgres + Better Auth
(email + password). Every user brings their own provider keys (Keys page); there
is no shared key.

## What the build produces

`npm run build` = `vite build` + `npm run db:migrate`.

- `dist/` – static assets (Netlify publish dir, set in `netlify.toml`)
- `.netlify/functions-internal/server/` – the single SSR/API function
  (`path: "/*"`, `preferStatic: true`); Netlify picks it up automatically
- `migrations/*.sql` are applied to the database during the build **if**
  `DATABASE_URL` (or `NETLIFY_DB_URL`) is set; applied files are tracked in a
  `_migrations` table, so re-running is safe.

`netlify.toml` sets `command = "npm run build"`, `publish = "dist"`,
`NODE_VERSION = "20"` (Vite 8 needs Node >= 20.19; Netlify's "20" resolves to the
latest 20.x).

## Environment variables

Set these on the Netlify site (scopes: **Builds** and **Functions**; mark the
secrets as secret):

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes* | Postgres connection string (e.g. Neon pooled URL). *Or use Netlify Database, which injects `NETLIFY_DB_URL`; the app reads `DATABASE_URL` first, then `NETLIFY_DB_URL`. |
| `BETTER_AUTH_SECRET` | yes | Random secret, e.g. `openssl rand -base64 32`. The function refuses to start in production without it. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | yes | `https://a.pathwaydevs.me` (the public origin; also the only trusted origin for sign-in POSTs) |
| `VITE_AUTH_ENABLED` | yes | `true` (build-time flag; anything except `false` enables auth, but set it explicitly) |
| `KEYS_ENCRYPTION_SECRET` | yes | Random secret, e.g. `openssl rand -base64 32`. Users' provider keys are encrypted at rest with AES-256-GCM (key derived from this). **In production, saving a key fails if this is unset.** Rotating/losing it makes stored keys unreadable (users re-enter them). |

No other variables are needed. Nothing Grok-platform related (`GROK_*`) is used
for sign-in any more.

Generate secrets locally and paste them; do not commit them:

```sh
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # KEYS_ENCRYPTION_SECRET
```

## Database

Any Postgres works. Options:

1. **Netlify Database** (Neon-backed, no separate signup). Free plan: 1 compute
   unit, 5 GB, sleeps after 5 min idle, shares your 300 credits/month hard cap.
   Created from the Netlify UI (Site → Data & Storage → Database) or
   `netlify database init` inside a linked site. It exposes `NETLIFY_DB_URL`
   (read automatically by this app) – set `DATABASE_URL` to the same string if
   you want to be explicit.
2. Your own Neon/Supabase/etc. project: set `DATABASE_URL`.

If neither variable is set in production the app refuses to start rather than
silently using the in-memory fallback database.

## Deploy

One-time (new site, never reuse the existing `pathway-roundtable` site):

```sh
netlify sites:create --name <new-site-name> --account-slug johnatlasgault1970
netlify link --name <new-site-name>
netlify env:set DATABASE_URL '<postgres url>' --secret
netlify env:set BETTER_AUTH_SECRET '<secret>' --secret
netlify env:set BETTER_AUTH_URL 'https://a.pathwaydevs.me'
netlify env:set VITE_AUTH_ENABLED true
netlify env:set KEYS_ENCRYPTION_SECRET '<secret>' --secret
```

Deploy (builds with the site's env, applies migrations, publishes):

```sh
netlify deploy --build --prod
```

Then attach the custom domain `a.pathwaydevs.me` to the new site (it is
currently attached elsewhere – move it deliberately) and make sure
`BETTER_AUTH_URL` matches the origin users type, otherwise sign-in is rejected
with "Invalid origin".

## Analytics

Google Analytics (`G-4HJCSN18F9`) loads only after a visitor presses Accept in
the cookie banner (choice stored in `localStorage` as `rt-analytics-consent`).
Decliners never load it. (The page still loads Google Fonts CSS, which is not
analytics but is a request to Google; self-host the fonts if that matters.)

## Local run, same as production

```sh
export DATABASE_URL=postgres://... BETTER_AUTH_SECRET=... KEYS_ENCRYPTION_SECRET=... \
       BETTER_AUTH_URL=http://127.0.0.1:8082 VITE_AUTH_ENABLED=true NODE_ENV=production
npm run build
PORT=8082 node scripts/serve-built.mjs   # dist/ + the Netlify function, like Netlify
```

(`vite preview`/`vite dev` also work for UI work, but their Node bridge keeps
only the last `Set-Cookie` of a response; this app is written so sign-in sets a
single cookie.)

## Security notes

- Sessions: HttpOnly, Secure, `SameSite=Lax`, `__Host-roundtable.*` cookie; no
  cookie cache, so sign-out is immediate.
- Rate limiting uses Netlify's `x-nf-client-connection-ip` header.
- Email verification and password reset are **not** configured (no email
  provider): accounts are created immediately and a forgotten password cannot be
  recovered by the user.
- The app's own server functions reject scripted cross-site requests
  (`Sec-Fetch-Site` check) and scope every query by the signed-in user id.
