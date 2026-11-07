# Supabase dashboard setup for Orma

Use the existing project whose URL is in the supplied env file. The URL and
server secret are already available locally; no new project is required.

## 1. Apply the database migration

1. Open the project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Select **SQL Editor**, then **New query**. Use the default `postgres` role.
3. Open [001_orma.sql](001_orma.sql) in this checkout, copy the **entire file**,
   paste it into the editor and click **Run**.
4. Expect a successful result. The script uses a transaction and creates 14
   `orma_*` tables plus the backend RPC and authorization helpers. It does not
   remove existing tables or Auth users.
5. If Supabase returns an error, copy the error message and line number back to
   Codex. Do not work around it by adding public access policies.

The migration enables row-level security and restricts canonical data to the
backend. The backend will verify the signed-in user's Supabase Auth token and
enforce family, owner and sharing permissions through `orma_server_action`.

## 2. Check email sign-in

1. Open **Authentication → Sign In / Providers → Email** (the page may be
   labelled **Providers**).
2. Keep **Email** enabled and allow new user signups.
3. For a private development project, **Confirm email** may be disabled to test
   account creation immediately. If it remains enabled, each account must
   confirm its email before signing in, and email delivery must be configured.
   Use email verification for a public release.
4. Save changes. Family members will get separate accounts through the app;
   they should not share one login. No manual `orma_profiles`/family rows are
   needed in the Table Editor.

Phone/SMS authentication is a separate later configuration. The current
integration is being built around email/password accounts and family pairing.

## 3. Create private storage

1. Open **Storage → New bucket**.
2. Name the bucket **`orma`**, matching `SUPABASE_STORAGE_BUCKET` in the supplied
   env file. If it already exists, check its settings instead.
3. Leave **Public bucket** **off**, then create/save it.

This is for private media such as prescription images and voice files. Bucket
creation alone does not enable those upload features; the backend integration
will supply authorization and temporary access links.

## 4. Add the mobile-safe publishable key

1. Open **Settings → API Keys**, or the project's **Connect** dialog.
2. Copy the **publishable** key beginning `sb_publishable_`.
3. Add it locally to the ignored `backend/supabase/.env.local`:

   ```dotenv
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
   ```

Keep the existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and
`SUPABASE_STORAGE_BUCKET` entries. The server secret remains backend-only.
Neither the database password nor a management access token is required for
these dashboard steps.

## 5. Verify and report completion

Run [verify_setup.sql](verify_setup.sql) in a new SQL Editor query. Expect:

- First result: `orma_table_count = 14`, with all four boolean columns `true`.
- Second result: bucket `orma`, with `public = false`.

Tell Codex the SQL succeeded, the verification results, whether email
confirmation is enabled, and that the publishable key has been saved locally.
Do not paste passwords or server secrets into chat. App/backend connection and
Pixel validation remain separate work; these SQL checks do not claim that the
connected app is already complete.

## Validation recorded

On 2026-11-07, the migration was applied to an isolated local PostgreSQL 17
database with Supabase-compatible role/Auth fixtures. Scenario checks passed
for pairing and profile ownership, shared medicine stock, duplicate blocking,
10-minute snooze without dose logging, unrelated-account denial, private count
and schedule filtering, and backend-only RPC/direct table grants. Hosted
project execution is still pending the user's dashboard step.

Official references: [SQL tables and security](https://supabase.com/docs/guides/database/tables),
[email/password auth](https://supabase.com/docs/guides/auth/passwords),
[API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[storage buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets).
