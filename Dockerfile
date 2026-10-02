# Node 24 is the Active LTS line (the README, the badge and package.json
# `engines` all target it). Odd-numbered majors never become LTS. Pinned by
# digest so a rebuild can't silently pick up a different image; Dependabot's
# `docker` ecosystem bumps the digest.
FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# Production deps, then drop the package managers: nothing at runtime runs
# npm/npx/corepack (the app and the migrate service both start with `node`),
# and the npm CLI bundled in the base image ships its own dependency tree
# (tar, undici, brace-expansion, ...) that Trivy would otherwise flag in an
# image that never executes it.
RUN npm ci --omit=dev && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=build /app/dist ./dist
COPY scripts ./scripts
COPY migrations ./migrations

USER node

EXPOSE 3000

# No curl/wget in the slim base image — Node's own http module needs no
# extra package. Only meaningful for the app service; the one-shot `migrate`
# container (same image, different command) has its healthcheck disabled in
# docker-compose.yml since it never listens on a port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Node as PID 1 doesn't reap zombies or get default signal handling, so
# docker-compose.yml runs the app with `init: true` (tini). It's done there
# rather than baked in here so the image stays a plain `node` entrypoint.
CMD ["node", "dist/server.js"]
