# GitNorm

GitNorm is a visual software home for people who make apps without wanting to learn Git. Add a folder or ZIP, keep every update as a restorable version, and publish a simple project page when it is ready.

GitNorm is a standalone Next.js application. It does not run on ChatGPT, require a ChatGPT account, or depend on OpenAI Sites.

## What works

- First-party passkey registration and sign-in, server-side sessions, logout, editable profiles, and permanent account deletion
- Private-by-default folder and ZIP import with local file review, secret/generated-file filtering, bounded ZIP expansion, and file/count/size quotas
- Direct browser-to-private-storage uploads, so 30 MB projects do not pass through a size-limited Vercel Function request
- A visual project shelf, file browser, streamed ZIP downloads, complete-folder updates, change summaries, atomic version numbers, and non-destructive restore
- Publish/unpublish, anonymous share pages and downloads, public creator profiles, and searchable discovery
- Immediate authorization revocation, owner isolation, origin checks, security headers, rate limits, and permanent storage deletion
- Custom GitNorm brand, project icons, workflow illustrations, favicons, and social preview art

## Stack

- Next.js 16 App Router and React 19
- Turso/libSQL for accounts, passkeys, sessions, projects, versions, manifests, upload intents, quotas, and rate counters
- Private Vercel Blob for immutable project archives
- SimpleWebAuthn for discoverable passkeys
- Playwright with Chromium virtual WebAuthn for the production-server user flow

Local development uses the same application code with a local libSQL database and filesystem archive store under `.gitnorm/`. Production refuses to fall back to ephemeral local data when Vercel environment variables are missing.

## Local development

Requires Node `>=20.9` and pnpm.

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. No external account or cloud service is required for local development.

Copy `.env.example` to `.env.local` only when you want to exercise real Turso or Vercel Blob resources. Never commit `.env.local`.

## Verification

```bash
pnpm verify
```

The release gate runs TypeScript, ESLint, a native Next.js production build, and Playwright against `next start`. The browser flow covers:

- independent passkey registration, logout, and sign-in;
- secret exclusion and exact ZIP contents;
- project creation, a complete-folder update, diff calculation, settings edits, and streamed download;
- a second user's denial across private detail, patch, delete, restore, download, and file endpoints;
- publish → anonymous share/discovery/profile/download/file access → immediate unpublish revocation;
- 20 concurrent non-destructive restores with unique contiguous version numbers;
- permanent project/account deletion and session invalidation.

## Deploy to Vercel

1. Import this GitHub repository as a new Vercel project. Vercel will detect Next.js and use `pnpm build`.
2. In the Vercel Marketplace, connect a Turso database. Make sure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are available to the project.
3. Create and connect a **private** Vercel Blob store. Vercel supplies `BLOB_READ_WRITE_TOKEN`; set `GITNORM_STORAGE_MODE=blob`.
4. Generate a long random `CRON_SECRET`. Vercel uses it to authenticate the scheduled cleanup route declared in `vercel.json`.
5. Attach the final production domain, then set:

   ```dotenv
   APP_ORIGIN=https://gitnorm.example.com
   WEBAUTHN_RP_ID=gitnorm.example.com
   ```

6. Apply the idempotent database migration with the production environment loaded:

   ```bash
   pnpm db:migrate
   ```

7. Deploy, then register a fresh passkey on the final domain and run the smoke flow: create → update → publish → anonymous download → unpublish → delete.

The application also applies its idempotent schema on first database access, but running the migration explicitly makes deployment failures visible before users arrive.

### Passkey domain warning

Passkeys are cryptographically bound to an RP ID. Configure the final domain before onboarding real users. Passkeys created on a preview `*.vercel.app` hostname will not automatically work after moving to an unrelated custom domain.

Vercel preview hosts are accepted when Vercel provides their trusted environment variables. `APP_ORIGIN` remains the canonical metadata and production origin.

## Storage flow

GitNorm never trusts a client-provided manifest:

1. The browser normalizes selected files and creates one ZIP.
2. The server issues a short-lived upload intent scoped to one user, project, pathname, content type, and size.
3. Production uploads directly to private Vercel Blob; local tests use an authenticated local PUT route.
4. The commit route fetches and validates the stored archive, rejects unsafe paths and ZIP bombs, computes hashes/MIME types, and atomically writes the version manifest.
5. Abandoned intents expire and are cleaned up. Deletion atomically tombstones every archive, waits out any issued upload token, and the authenticated daily cleanup removes the object permanently.

## Limits

- 50 active projects per account
- 100 saved versions per project
- 10 concurrent pending uploads per account
- 250 files per version
- 8 MB per file
- 30 MB expanded project size
- 34 MB uploaded ZIP size

Uploaded HTML, SVG, and other scriptable files are never executed as a GitNorm page. Authorization-sensitive responses use `nosniff` and `no-store` controls.
