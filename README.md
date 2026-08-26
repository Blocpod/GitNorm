# GitNorm

GitNorm is a visual software home for people who make apps without wanting to learn Git. Creators add a folder or ZIP, keep every update as a restorable version, and publish a simple project page when they are ready.

It is a normal public web application. Accounts use first-party passkeys; GitNorm does not require a ChatGPT account or trust identity headers from ChatGPT.

## What works

- Independent passkey sign-up, sign-in, server-side sessions, logout, editable profiles, and permanent account deletion
- Private-by-default folder and ZIP import with file review, bounded ZIP expansion, secret/generated-file filtering, file/count/size quotas, and D1/R2 persistence
- Visual project shelf, plain-language file browser, ZIP download, complete-folder updates, change summaries, atomic version numbers, and non-destructive restore
- Publish/unpublish, anonymous share pages and downloads, public creator profiles, and searchable public discovery
- Immediate authorization revocation with no cacheable project-file responses
- Permanent project deletion including stored R2 objects
- Two-user owner isolation, request-origin checks, security headers, auth/download rate limits, and an automated virtual-passkey browser suite

## Local development

Requires Node `>=22.13.0`.

```bash
pnpm install
pnpm dev
```

The local app is available at `http://localhost:3000`. D1 and R2 are supplied through the OpenAI Sites/Cloudflare development runtime.

## Verification

```bash
npm run verify
```

The verification gate runs TypeScript, ESLint, a production Vinext build, and Playwright. The browser suite uses Chromium's virtual WebAuthn authenticator and covers:

- standalone passkey registration, logout, and sign-in;
- sensitive-file exclusion during ZIP import;
- project persistence;
- a second user's denial across private detail, patch, delete, restore, download, and file endpoints;
- publish → anonymous share/discovery/profile/download/file access → immediate unpublish revocation;
- 20 concurrent restores with unique contiguous version numbers;
- permanent project/account deletion and session invalidation.

## Architecture

- Next.js 16 App Router compiled by Vinext
- Cloudflare D1 for profiles, passkeys, one-time challenges, hashed sessions, projects, versions, file metadata, quotas, and rate counters
- Cloudflare R2 for content-addressed project blobs
- SimpleWebAuthn for discoverable passkeys
- Secure, HttpOnly, SameSite=Lax `__Host-gitnorm_session` cookies in production; only SHA-256 token hashes are stored

Passkeys are bound to `gitnorm.blocpodcreative.chatgpt.site`. Changing the production hostname requires an intentional RP-ID migration plan; existing passkeys cannot simply be moved to an unrelated domain.

## Limits

- 50 active projects per account
- 100 saved versions per project
- 250 files per version
- 8 MB per file
- 30 MB expanded project size

Uploaded HTML, SVG, and other scriptable files are never executed as a GitNorm page. Authorization-sensitive files are served with `nosniff` and `no-store` controls.
