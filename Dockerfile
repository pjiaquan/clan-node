# Pin the base by digest for a reproducible build. Resolve one with:
#   docker buildx imagetools inspect node:20-bookworm-slim
# then replace the tag below with node:20-bookworm-slim@sha256:<digest>.
ARG NODE_IMAGE=node:20-bookworm-slim

FROM ${NODE_IMAGE} AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_API_BASE=
ENV VITE_API_BASE=${VITE_API_BASE}

RUN npm run build

# Native modules (better-sqlite3) are compiled here so the toolchain never
# reaches the runtime image.
FROM ${NODE_IMAGE} AS server-deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM ${NODE_IMAGE}

WORKDIR /app

ENV NODE_ENV=production \
    CLAN_DATA_DIR=/var/lib/clan-node

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
# Only what the server actually runs. The previous `COPY . .` also shipped the
# test suite, the operational scripts in scripts/, the CI workflows and the
# local .env files that .dockerignore happened to cover.
COPY src ./src
COPY migrations ./migrations
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Run unprivileged. The container used to run as root, which turned any file
# write or read reachable through the app into a root-level one.
#
# The data directory is created here so that a fresh named volume inherits
# this ownership. An existing root-owned volume needs a one-time:
#   docker compose run --rm --user root clan-node chown -R node:node /var/lib/clan-node
RUN mkdir -p "$CLAN_DATA_DIR" && chown -R node:node "$CLAN_DATA_DIR" /app
USER node

EXPOSE 8080

CMD ["./node_modules/.bin/tsx", "src/selfhost/server.ts"]
