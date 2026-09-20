# syntax=docker/dockerfile:1
#
# Admin portal image — multi-stage, Next.js standalone output.
#
# Identical in shape to the website image. The build context is the repository root
# because a workspace install needs the root lockfile and every workspace manifest.
#
# In a deployed environment this image is expected to run behind a VPN or an IP
# allow-list — the portal is staff-only. That control belongs at the ingress, not in
# this file; the image itself is the same kind of artifact as the website's.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
# See website.Dockerfile: the backend workspace's `postinstall` runs
# `prisma generate`, which needs `./prisma/schema.prisma` to be present because npm
# runs lifecycle scripts with the workspace as the working directory. Without this
# the root `npm ci` fails and the image cannot be built.
COPY backend/prisma ./backend/prisma
COPY admin-portal/package.json ./admin-portal/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/shared-utils/package.json ./packages/shared-utils/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci

FROM deps AS build
COPY packages ./packages
COPY admin-portal ./admin-portal
# The runtime stage copies `public/` unconditionally, and this app has no static
# assets yet, so the directory does not exist in the repository. Creating it here is
# what makes that COPY resolve; without it the build dies at the final step with
# "failed to compute cache key: .../admin-portal/public: not found".
RUN mkdir -p admin-portal/public

RUN npm run build:shared \
  && npm run build --workspace=@medichain/api-client \
  && npm run build --workspace=@medichain/ui \
  && npm run build --workspace=@medichain/admin-portal

FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3002
# See website.Dockerfile: Next's standalone server binds to HOSTNAME, which Docker
# sets to the container id, so 127.0.0.1 is never bound and the health check fails
# forever while the app looks healthy from outside.
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /repo/admin-portal/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/admin-portal/.next/static ./admin-portal/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/admin-portal/public ./admin-portal/public

USER nextjs
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "admin-portal/server.js"]
