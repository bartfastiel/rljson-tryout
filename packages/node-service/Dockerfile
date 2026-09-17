# syntax=docker/dockerfile:1
#
# Build context is the repository root, so this image can install the
# workspace dependencies of `@rljson-tryout/node-service` and typecheck the
# whole workspace before bundling. See `docs/roadmap.md` section 4.1.

FROM node:25-alpine AS base
RUN corepack enable

# Only the files pnpm needs to resolve the dependency graph. This layer is
# cached across builds until the lockfile or a package manifest changes.
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/node-service/package.json packages/node-service/package.json
COPY packages/web-app/package.json packages/web-app/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch

# The full source, installed offline from the fetch cache, typechecked and
# bundled into one ECMAScript module.
FROM deps AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile
RUN pnpm -r typecheck
RUN pnpm --filter @rljson-tryout/node-service run bundle
RUN node -e "\
    const fs = require('node:fs'); \
    const source = JSON.parse(fs.readFileSync('packages/node-service/package.json', 'utf-8')); \
    const runtime = { name: source.name, version: source.version }; \
    fs.writeFileSync('runtime-package.json', JSON.stringify(runtime) + '\n');"

# A minimal runtime with no pnpm store, no sources and no dev dependencies:
# the bundle already contains every dependency it needs, and the web app is
# static files served from `public`.
FROM node:25-alpine AS runtime
ARG GIT_COMMIT
ENV GIT_COMMIT=${GIT_COMMIT}
ENV NODE_ENV=production
ENV WEB_APP_DIRECTORY=/app/public
WORKDIR /app
COPY --from=build --chown=node:node /repo/packages/node-service/dist/main.mjs ./dist/main.mjs
COPY --from=build --chown=node:node /repo/packages/web-app/public ./public
COPY --from=build --chown=node:node /repo/runtime-package.json ./package.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1))"
CMD ["node", "dist/main.mjs"]
