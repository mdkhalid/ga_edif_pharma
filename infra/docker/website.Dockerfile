# syntax=docker/dockerfile:1
#
# Website image — multi-stage, Next.js standalone output.
#
# The build context is the repository root, because a workspace install needs the
# root package-lock.json and every workspace manifest. Building from `website/`
# would produce an image whose node_modules does not match what CI tested.

ARG NODE_VERSION=22

# ---------------------------------------------------------------- deps
# Only manifests are copied here, so a source-only change does not invalidate the
# install layer.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
# The `backend` workspace carries a `postinstall` that runs `prisma generate`, and
# npm runs a workspace's lifecycle scripts with that workspace as the working
# directory. The manifest alone is therefore not enough — `prisma generate`
# resolves `./prisma/schema.prisma`, and without it `npm ci` fails outright and
# this image cannot be built at all. The website never imports the Prisma client;
# this exists only because one root `npm ci` installs every workspace.
COPY backend/prisma ./backend/prisma
COPY website/package.json ./website/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/shared-utils/package.json ./packages/shared-utils/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci

# ---------------------------------------------------------------- build
FROM deps AS build
COPY packages ./packages
COPY website ./website
# Created rather than assumed. The runtime stage copies `public/` unconditionally, and
# a Next app is allowed to have no static assets — the admin portal is exactly that
# case, and its image failed to build until this directory was made to exist.
RUN mkdir -p website/public

RUN npm run build:shared \
  && npm run build --workspace=@medichain/api-client \
  && npm run build --workspace=@medichain/ui \
  && npm run build --workspace=@medichain/website

# -------------------------------------------------------------- runtime
# `standalone` traces the exact modules each route needs, so the runtime image
# carries neither the rest of the monorepo nor the dev dependencies.
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
# Next's standalone server binds to `process.env.HOSTNAME`, and Docker sets HOSTNAME
# to the container id. Left alone, the server listens on the container's own address
# and never on 127.0.0.1 — published ports still work, so this is invisible from
# outside, but the HEALTHCHECK below fails on every attempt and the container is
# reported unhealthy forever.
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /repo/website/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/website/.next/static ./website/.next/static
# `public/` may legitimately be empty. The build stage creates it when the app has no
# static assets, so this COPY always has a source to copy.
COPY --from=build --chown=nextjs:nodejs /repo/website/public ./website/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "website/server.js"]
