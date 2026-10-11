# Security

## Reporting

Please report suspected vulnerabilities privately through GitHub's "Report a
vulnerability" button on the Security tab, not as a public issue.

## Repository settings that are not in this repo

The files here cover what version control can cover. These are account-level
toggles that have to be set on the repository itself, and this repository is
public, so all of them are free:

```bash
# Secret scanning, push protection (blocks a commit that contains a key before
# it is published) and automatic Dependabot security PRs.
gh api -X PATCH repos/<owner>/clan-node \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_non_provider_patterns][status]=enabled' \
  -f 'security_and_analysis[dependabot_security_updates][status]=enabled'
```

Verify with:

```bash
gh api repos/<owner>/clan-node --jq .security_and_analysis
```

A history scan found no committed credentials, so enabling these is about
preventing the next accident rather than cleaning up an existing leak.

## What is automated here

- `.github/dependabot.yml` — weekly npm (root and `frontend/`), GitHub Actions
  and Docker base-image updates. Development dependencies are grouped so a
  runtime security bump is not buried among toolchain churn.
- `.github/workflows/codeql.yml` — CodeQL with `security-extended` on pushes,
  pull requests and weekly.
- Actions are pinned to commit SHAs with the intended tag in a trailing
  comment. A moving tag such as `@v4` is mutable: whoever controls the action
  can repoint it at new code that then runs with this repository's secrets.
  Dependabot's `github-actions` entry keeps the pins current.

## Secrets

No secret belongs in `wrangler.worker.toml`; `[vars]` is public configuration.
`AUTH_ENCRYPTION_KEY`, `ADMIN_SETUP_TOKEN`, `BREVO_API_KEY`, `TELEGRAM_*` and
the `DUAL_WRITE_*` credentials are set with `wrangler secret put`, or through
`selfhost.env` (git-ignored) for the Docker stack.

## Deployment expectations

- `ENVIRONMENT=production`. The Worker refuses to serve an unrecognized value,
  but `development` is a valid setting that disables the Secure cookie flag and
  HSTS and stops requiring `AUTH_ENCRYPTION_KEY`.
- `npm run deploy` targets `--env production`. The default environment is
  marked `workers_dev = false` so it cannot be published.
- `ALLOWED_EMAILS` is set. An unset list means "no restriction".
- `PUBLIC_REGISTRATION_ENABLED` stays unset unless public sign-up is wanted;
  when enabled it also requires `ALLOWED_EMAILS` and working e-mail delivery.
- `EXPOSE_DEBUG_TOKENS` is never set on a reachable instance: it puts MFA codes
  and invite tokens in API responses.
- Self-host behind a reverse proxy sets `TRUSTED_PROXY=1`, otherwise rate
  limiting and audit entries use the proxy's address for everyone.

## Protected fields

Person dates, blood type, metadata and custom field values are encrypted with
`AUTH_ENCRYPTION_KEY` (AES-GCM, `src/data_protection.ts`). Values written as
`enc:v2` bind the table, column and owning person into the ciphertext as AAD,
so a value only decrypts where it was written. A ciphertext copied onto another
person or column is refused, not disclosed.

Older rows hold `enc:v1`, which binds nothing. Rows are re-encrypted as v2 when
the people API or a backup export reads them. While v1 is still accepted, though, any v1 value pasted into a protected
column still decrypts. That includes `users.mfa_totp_secret`, which uses the
same key and stays v1. To close that gap once the data has been migrated:

1. Run a backup export. It migrates every person and custom field row.
2. Confirm nothing is left (both counts should be `0`):

   ```sql
   SELECT COUNT(*) FROM people
    WHERE blood_type LIKE 'enc:v1:%' OR dob LIKE 'enc:v1:%' OR dod LIKE 'enc:v1:%'
       OR tob LIKE 'enc:v1:%' OR tod LIKE 'enc:v1:%' OR metadata LIKE 'enc:v1:%';
   SELECT COUNT(*) FROM person_custom_fields WHERE value LIKE 'enc:v1:%';
   ```

3. Set `DATA_PROTECTION_REJECT_LEGACY=true`: under `[env.production.vars]` in
   `wrangler.worker.toml` followed by `npm run deploy`, or in `selfhost.env`
   followed by `npm run docker:up`. A value set only in the Cloudflare
   dashboard is dropped by the next `wrangler deploy`. After that, a v1 value in
   a protected column fails to decrypt and is never re-encrypted as v2. MFA is
   unaffected: TOTP secrets are decrypted by `src/auth.ts`, not by this path.

## Databases

The two Worker environments use different D1 databases: `clan-db` for
`[env.production]` and `clan-db-dev` for the default environment. They used to
share one, so `wrangler dev --remote` wrote to live family data.

`wrangler d1 execute` resolves the database by the **name on the command
line**, not by the binding. The name is what decides which data you touch, and
it must be declared in the environment you select: `clan-db` exists only under
`[env.production]`, so every remote command against it needs `--env production`.
Without it Wrangler cannot find `clan-db` in the config, falls back to an API
lookup by name, and fails with a misleading `Authentication error [code: 10000]`.

```bash
npm run d1:query -- "SELECT COUNT(*) FROM people"   # clan-db-dev, local
npm run d1:migrate                                   # clan-db-dev, local
npm run d1:migrate:prod                              # clan-db, REMOTE (--env production)

# Ad hoc remote query against production:
npx wrangler --config wrangler.worker.toml d1 execute clan-db --env production --remote --command "SELECT 1"
```

`scripts/push_local_d1.sh` and `scripts/pull_remote_d1.sh` take the two names
separately (`REMOTE_DB_NAME`, `LOCAL_DB_NAME`) for the same reason, and pass
`--env "$REMOTE_ENV"` (default `production`) on every remote call.
