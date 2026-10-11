# Clan Node

Clan Node is a graph-based family tree system with:

- account-based access control
- invitation, password reset, and MFA flows
- graph layers for separate family branches or datasets
- audit logs and notification workflows
- avatar storage and encrypted protected fields

This repository can now self-host without Cloudflare runtime dependencies. The Docker stack runs as a single container:

- a native Node server
- a built-in static frontend
- a SQLite database file
- local filesystem avatar storage

## Self-Hosted Quick Start

### 1. Prepare the environment file

```bash
cp selfhost.env.example selfhost.env
```

Generate strong secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Set at least these values in `selfhost.env`:

- `AUTH_ENCRYPTION_KEY`
- `ADMIN_SETUP_TOKEN`
- `FRONTEND_ORIGIN`
- `EMAIL_VERIFICATION_URL_BASE`
- `PASSWORD_RESET_URL_BASE`

For local use, the example defaults are fine if you serve on `http://localhost:8080`.

### 2. Start the stack

```bash
docker compose up -d --build
```

If port `8080` is already in use:

```bash
CLAN_HTTP_PORT=18080 docker compose up -d --build
```

Then open:

```text
http://localhost:8080
```

or the overridden port.

The container publishes to `127.0.0.1` only, runs as an unprivileged user and
drops all Linux capabilities. To reach it from another machine, put a reverse
proxy in front of it (and set `TRUSTED_PROXY=1` so rate limiting and audit
entries use the forwarded client address). Publishing directly to the network
is a deliberate choice:

```bash
CLAN_BIND_ADDRESS=0.0.0.0 docker compose up -d
```

### Upgrading an existing container

Only needed if you already ran an earlier version of the stack on this
machine. Check:

```bash
docker volume ls | grep clan_node_state
```

If that prints nothing there is no volume yet, and a fresh one will be created
with the right ownership -- skip this section.

If it does exist, the volume was created while the server still ran as root
and is owned by the wrong user. Fix it once, before starting, from the
directory that holds your `selfhost.env` (compose requires that file, so this
fails with `env file ... not found` anywhere else):

```bash
docker compose run --rm --user root clan-node chown -R node:node /var/lib/clan-node
```

### 3. First-time setup

On a fresh install the app will prompt for initial admin setup.

For hardened deployments, use:

- `ENVIRONMENT=production`
- HTTPS in front of the web container
- strong values for `ADMIN_SETUP_TOKEN` and `AUTH_ENCRYPTION_KEY`

## Architecture

The self-hosted stack is intentionally single-origin:

- browser traffic, static assets, and API requests all go to one service
- `/api/*` and `/avatars/*` are served by the same Node process
- auth cookies stay same-origin

Persistence is stored in the Docker volume `clan_node_state`:

- `clan-node.sqlite`
- avatar files

The backend initializes the schema from `migrations/schema.sql` automatically on startup.

## Runtime Files

- `docker-compose.yml`
- `Dockerfile`
- `selfhost.env.example`
- `src/selfhost/server.ts`
- `src/selfhost/sqlite_d1.ts`
- `src/selfhost/local_r2.ts`

## Security Notes

### Recommended minimum

- set a strong `AUTH_ENCRYPTION_KEY`
- set a strong `ADMIN_SETUP_TOKEN`
- keep `selfhost.env` private and off Git
- put HTTPS in front of the container for internet-facing use

### Internet-facing deployment

If you expose this beyond localhost or a trusted LAN:

1. terminate TLS at a reverse proxy or load balancer
2. set `FRONTEND_ORIGIN` to the final HTTPS URL
3. set `EMAIL_VERIFICATION_URL_BASE` to the same HTTPS URL
4. set `PASSWORD_RESET_URL_BASE` to the same HTTPS URL
5. set `ENVIRONMENT=production`

Why:

- production mode enables secure-cookie behavior
- production mode enables HSTS on API responses
- password reset and verification links must point to the final public origin

### Optional integrations

Mail delivery:

- `BREVO_API_KEY`
- `BREVO_FROM_EMAIL`
- `BREVO_FROM_NAME`

Telegram notifications:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

If unset, those features are skipped without preventing startup.

## Operations

### Logs

```bash
docker compose logs -f
```

### Update

```bash
git pull
docker compose up -d --build
```

### Stop

```bash
docker compose down
```

### Remove the stack and persisted data

```bash
docker compose down -v
```

That deletes the local SQLite database and avatars.

## Backup And Restore

The important persistent data lives in the Docker volume `clan_node_state`.

### Backup

```bash
docker run --rm \
  -v clan-node_clan_node_state:/data \
  -v "$PWD:/backup" \
  alpine \
  tar czf /backup/clan-node-state.tgz -C /data .
```

### Restore

```bash
docker compose down
docker run --rm \
  -v clan-node_clan_node_state:/data \
  -v "$PWD:/backup" \
  alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/clan-node-state.tgz -C /data"
docker compose up -d
```

If your Docker Compose project name differs, adjust the volume name accordingly.

## Local Development

Cloudflare-native development is still available with Wrangler:

```bash
npm run dev
```

Native self-host development is also available:

```bash
npm run dev:selfhost
```

That starts the Node server on port `8787` using local SQLite, filesystem avatar storage, and the built frontend if `frontend/dist` exists.

To serve the frontend from it, build it first with an empty `VITE_API_BASE`, as the Dockerfile does:

```bash
cd frontend && npm ci && VITE_API_BASE= npm run build
```

Without `VITE_API_BASE=`, a build opened on localhost sends its API calls to port `8787`. That happens to work for `npm run dev:selfhost`, but on any other `PORT` the page's `connect-src 'self'` policy blocks them.
