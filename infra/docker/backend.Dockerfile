# syntax=docker/dockerfile:1.7
# ============================================================================
# MediChain backend image.
#
# Build from the repository root (the build context is the whole monorepo,
# because the backend consumes the two shared workspace packages):
#
#   docker build -f infra/docker/backend.Dockerfile -t medichain-backend .
#
# ## Why the runtime stage keeps the monorepo layout
#
# npm workspaces links `node_modules/@medichain/shared-types` as a *symlink* to
# `packages/shared-types`. Copying `node_modules` into a flat `/app` would leave
# that symlink dangling, and the container would fail at `require` time with a
# module-not-found that looks nothing like its cause. The runtime stage
# therefore preserves the `/repo` → `/repo/backend` → `/repo/packages` layout so
# every link resolves.
# ============================================================================

ARG NODE_VERSION=22

# ── Stage 1 — dependencies ──────────────────────────────────────────────────
# Manifests only, so this layer is cached until a dependency actually changes.
# Adding a workspace package? Add its package.json here too, or `npm ci` will
# install a tree that does not match the lockfile.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY packages/config/package.json ./packages/config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/

RUN npm ci

# ── Stage 2 — compile ───────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo

COPY packages ./packages
COPY backend ./backend

# Order matters: the backend's TypeScript resolves `@medichain/shared-*` to the
# packages' built `dist`, so they must exist before `nest build` runs.
RUN npm run build:shared \
 && npm run db:generate --workspace=@medichain/backend \
 && npm run build --workspace=@medichain/backend

# ── Stage 3 — production dependency tree ────────────────────────────────────
FROM deps AS prod-deps
WORKDIR /repo
RUN npm prune --omit=dev

# ── Stage 4 — runtime ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime

# tini reaps zombies and forwards SIGTERM, so the graceful-shutdown handler in
# main.ts actually receives the signal instead of the container being SIGKILLed.
RUN apk add --no-cache tini \
 && addgroup -S -g 1001 medichain \
 && adduser -S -u 1001 -G medichain medichain

WORKDIR /repo
ENV NODE_ENV=production

# Dependency tree and workspace manifests, symlinks intact.
COPY --from=prod-deps --chown=medichain:medichain /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=medichain:medichain /repo/package.json ./package.json
COPY --from=prod-deps --chown=medichain:medichain /repo/backend/package.json ./backend/package.json
COPY --from=prod-deps --chown=medichain:medichain /repo/packages ./packages

# Compiled output. `prisma/` ships with the image because migrations are applied
# by this artifact in the deploy job, not by a developer's machine.
COPY --from=build --chown=medichain:medichain /repo/backend/dist ./backend/dist
COPY --from=build --chown=medichain:medichain /repo/backend/prisma ./backend/prisma
COPY --from=build --chown=medichain:medichain /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=medichain:medichain /repo/packages/shared-utils/dist ./packages/shared-utils/dist

# The generated Prisma client lives inside node_modules and is produced by
# `prisma generate` in the build stage. `npm prune` cannot recreate it, so it is
# carried across explicitly.
COPY --from=build --chown=medichain:medichain /repo/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=medichain:medichain /repo/node_modules/@prisma/client ./node_modules/@prisma/client

USER medichain
WORKDIR /repo/backend

EXPOSE 3000

# Liveness only. Readiness depends on Postgres and Redis, and a container that
# restarts itself because a dependency is briefly down turns one outage into a
# crash-loop — the same distinction the API makes between /health/live and
# /health/ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
