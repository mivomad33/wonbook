# Wonbook Development Guide

[한국어](DEVELOPMENT.md) | **English** · [Back to README](README.en.md)

This guide covers the procedures for developing and operating this repository: setup, development, testing, the database, backups, and deployment. For an introduction to the project, see the [README](README.en.md).

## Initial setup

- The project uses Node 24 (`.nvmrc`) and pnpm.
- If `pnpm install` asks you to approve the better-sqlite3 build script (`pnpm approve-builds`), do not approve it. The package works with its bundled binary, and approving it makes the installation fail. better-sqlite3 is used only by the command that migrates the old local DB and by the check commands.
- You need the Postgres 18 client tools (`pg_dump`, `pg_restore`) (`brew install postgresql@18`).
- Copy `.env.example` to `.env.local` and fill in the values. `.env.local` is excluded from git and from deployments.

```bash
pnpm install
```

### Environment variables

Only the names are listed here. The values live only in `.env.local` and in the Vercel Production environment variables.

- DB: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (development), `TEST_DATABASE_URL`, `TEST_DATABASE_URL_UNPOOLED` (test), `PROD_DATABASE_URL`, `PROD_DATABASE_URL_UNPOOLED` (production)
- Neon API (test branch and temporary branches): `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PROD_BRANCH_ID`, `NEON_DEV_BRANCH_ID`, `NEON_TEST_BRANCH_ID`
- Google sign-in: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Administrator: `ADMIN_EMAIL`
- Server keys (random 32 bytes, base64): `ACCOUNT_HASH_KEY` (account hashes), `PASSWORD_ENCRYPTION_KEY` (KakaoBank passwords), `BACKUP_ENCRYPTION_KEY` (backups). If they are lost, backups cannot be decrypted and accounts cannot be matched, so keep a separate copy outside the Mac as well.
- Automatic classification: `ANTHROPIC_API_KEY`. The limits can be changed with `CLASSIFY_USER_DAILY_LIMIT` (default 500) and `CLASSIFY_TOTAL_DAILY_LIMIT` (default 3000).
- For real sample checks: `KAKAOBANK_FILE_PASSWORD`

Secret variable names must contain one of `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, or `DATABASE_URL` (the public repository check looks for the values of variables with these names).

## Development

The default target of DB commands is the **development DB** (the Neon `dev` branch). The production DB is selected only when you pass `--prod`.

```bash
pnpm db:dev-reset
```

This empties the development DB, applies the migrations from scratch, creates the test users (user1, user2), and loads seed data into user1.

```bash
pnpm dev
```

Open http://localhost:3000 (this is the Google sign-in callback address). Features that exist only on the development server:

- Test sign-in: `/api/auth/dev-login?as=admin`, `?as=user1`, `?as=user2`, and so on. This signs you in as that user without Google. The build output does not include this route.
- The "Development DB" label at the bottom of the screen
- When enabled with `WONBOOK_FAKE_CLASSIFIER=1`, a fake classifier is used instead of the Claude API.

Real sample files (`samples/`, excluded from git) are uploaded only to the development DB. Instead of typing the KakaoBank sample password on screen, save it to user2 with the following command (the value is not printed).

```bash
pnpm exec tsx scripts/dev-kakao-password.ts
```

## Testing

```bash
pnpm test
```

These are the unit tests. Tests that need a DB run against an in-process Postgres (PGlite), so no external DB is required.

```bash
pnpm test:integration
```

These are the integration tests. They verify server action permissions, user isolation, upload limits, concurrent requests against the classification limit, and account deletion on a real Postgres (the Neon `test` branch). At startup they drop and recreate the schema of the `test` branch. Required variables: `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_TEST_BRANCH_ID` (plus the production and development branch IDs).

```bash
pnpm test:e2e
```

These are the E2E tests (Playwright, desktop and 375px). They start a separate development server on port 3100 that uses the `test` branch. Because they use the same branch as the integration tests, do not run the two at the same time. Screenshots are stored outside the repository. You need to run `pnpm exec playwright install chromium` once beforehand.

```bash
pnpm exec playwright test -c playwright.samples.config.ts
```

This is the real sample check (only when `samples/` exists). With `pnpm dev` running, it reads and uploads the real samples in the browser, and checks that the requests sent to the server contain neither the original files nor account identifiers, and that the parsing results in the browser and in Node are the same.

```bash
pnpm verify
```

This runs type checking, linting, unit tests, and the build in order. The pre-push check and CI use the same command.

## Changing the DB schema

1. Edit `src/db/schema.ts`.
2. Generate a migration file.

```bash
pnpm db:generate
```

3. Apply it to the development DB and verify it.

```bash
pnpm db:migrate
```

4. Before deploying, apply it to the production DB. An encrypted backup is taken automatically before it is applied.

```bash
pnpm db:migrate --prod
```

## Backup and restore

```bash
pnpm db:backup --prod
```

This dumps the production DB with `pg_dump`, encrypts it immediately (AES-256-GCM, key `BACKUP_ENCRYPTION_KEY`), and writes it to `data/backups/prod-<date>-<time>.dump.enc`. No plaintext dump is left on disk. Only the 10 most recent backups are kept for each target. Commands that change the production DB (migrations, data migration) take a backup automatically before running.

To restore, decrypt the backup and pipe it straight into `pg_restore`. If the key is wrong or the file is corrupted, it fails without outputting anything.

```bash
pnpm -s db:backup-decrypt data/backups/prod-20261023-120000.dump.enc | pg_restore -l
```

```bash
pnpm -s db:backup-decrypt data/backups/prod-20261023-120000.dump.enc | pg_restore --clean --if-exists --no-owner --no-privileges -d "<target DB URL>"
```

To run the personal data checks (plaintext search, wrong key, account identifiers) on a backup, use the following.

```bash
pnpm check:db --backup data/backups/prod-20261023-120000.dump.enc
```

## Migrating the old local DB

This command migrates the SQLite DB of the old local app (`data/wonbook.db`) into the administrator account in the production DB. Account numbers are converted to a hash and the last 4 digits, account numbers in transaction descriptions, memos, and file names are masked, and the raw transaction rows are not migrated. If administrator data already exists, nothing is changed. After the migration, the asset overview, the monthly figures for the last three months, and the transaction counts per account are compared with values calculated from the local DB.

```bash
pnpm db:import-rehearsal
```

This creates a temporary branch from the `test` branch, runs a trial migration into it, verifies the result, and then deletes that branch.

```bash
pnpm db:import-local --prod
```

This migrates into the production DB. The real local DB is migrated only to production; for the development and test DBs, use only `--from <fake SQLite file>`.

## Administrator

The Google account whose email matches `ADMIN_EMAIL` is the administrator. An admin screen appears in the sidebar, and it shows only the number of registered users and today's classification usage. The administrator is exempt from the classification limits.

When the old local DB is migrated, the administrator account is created in advance without a Google account. The first time you sign in with Google using that email on the production site, it is linked to that account instead of creating a new one.

## Deployment

Deployment to the Vercel project `wonbook` (function region `sin1`) is done only with local commands. Git integration is not used. The Vercel CLI is run as `npx --yes vercel@65.1.0` (commands that overwrite `.env.local`, such as `vercel env pull`, are not used).

Prepare the following once at the start.

- Project link: `vercel link` creates or overwrites `.env.local` in the linked folder, so run `npx --yes vercel@65.1.0 link --yes --project wonbook` in an empty temporary folder, then move only that folder's `.vercel/project.json` into `.vercel/` at the repository root.
- Environment variables: the following command adds the `.env.local` values to Vercel **Production** only, as Sensitive (`DATABASE_URL` gets the value of `PROD_DATABASE_URL`). Values are passed through standard input and are not printed.

```bash
pnpm exec tsx scripts/vercel-env.ts
```

- Enable usage analytics (before the first production deployment): `npx --yes vercel@65.1.0 project web-analytics enable wonbook`

Deployment is done with this single command.

```bash
pnpm release
```

Order: `verify` → export only the committed files to a temporary folder outside the working folder → `vercel build` (Production) → deployment output check (`check:output`) → `vercel deploy --prebuilt --prod` → post-deployment check (`smoke`). If any step fails, it stops, and it does not deploy if there are uncommitted changes.

- Deployment output check: verifies that the output contains no private files, forbidden strings, secret values, account identifiers, or test sign-in routes, and that the meta tags of the landing page and the privacy policy, the icons, `robots.txt`, and `sitemap.xml` are correct.
- The post-deployment check can also be run on its own (it makes no state-changing requests).

```bash
pnpm smoke https://wonbook.vercel.app
```

- The collection path of usage analytics (Vercel Web Analytics), `/_vercel/insights/*`, may not be attached in prebuilt deployments. If only the analytics script fails in the post-deployment check, confirm that Analytics is enabled and deploy once more. If that still does not work, deploy with a remote build. After passing the same local build and output check, Vercel builds a clean temporary folder exported from the same commit.

```bash
pnpm release --remote-build
```

- If the check fails, fix the cause and deploy again. If the problem is unrelated to production data, you can roll back to the previous deployment from the Vercel dashboard or with `vercel rollback`.

### Viewing errors in production

Errors are viewed in the Vercel function logs (Dashboard → Project → Logs). There are no separate error alerts. The logs record only the error type and location, never transaction details, amounts, account numbers, emails, or secret values.

```bash
npx --yes vercel@65.1.0 logs --project wonbook --environment production --since 1h
```

## Pre-push check and CI

`pnpm install` sets the git hooks folder to `.githooks`. On every push, it runs `pnpm verify` and the public repository check (`pnpm check:repo`), and blocks the push if either fails. The public repository check searches every commit, commit message, and branch name for private files, forbidden strings, and secret values. The check criteria are read from a private list outside the repository and from `.env.local`. Do not skip the hook.

GitHub Actions (CI) runs "Check" (type checking, linting, unit tests) and "Build" on every branch push and PR. It does not deploy.
