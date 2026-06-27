# DuoPlus Console — production image (single-process).
#
# NOTE: this repository is a monorepo holding many unrelated projects. This image
# is for the DuoPlus console ONLY. It builds the shared + web workspaces, then
# runs the proxy with SERVE_WEB=1 so one process serves both the JSON API and the
# built SPA. The Docker build context is large (whole repo) — prefer running the
# build from a checkout that excludes the other projects, or rely on .dockerignore.
#
# HTTPS is NOT terminated here — front this with a reverse proxy.

# ---- Stage 1: build shared + web ----
FROM node:24-slim AS build
WORKDIR /app

# Workspace manifests + lockfile first for cacheable install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY proxy/package.json ./proxy/
COPY web/package.json ./web/
COPY mock-server/package.json ./mock-server/
RUN npm ci

# Sources for the DuoPlus workspaces only.
COPY shared ./shared
COPY proxy ./proxy
COPY web ./web

# Optional: bake the console token into the web bundle. Must match the proxy's
# CONSOLE_TOKEN at runtime. Leave empty to build an un-gated bundle.
ARG VITE_CONSOLE_TOKEN=""
ENV VITE_CONSOLE_TOKEN=${VITE_CONSOLE_TOKEN}

RUN npm run build:shared && npm run build -w web

# ---- Stage 2: runtime (proxy serves the API + built web) ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SERVE_WEB=1
ENV PROXY_PORT=4000

# Bring the installed deps + built artifacts from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/proxy ./proxy
COPY --from=build /app/web/dist ./web/dist

EXPOSE 4000

# tsx runs the proxy's TypeScript entrypoint directly (shared is imported as TS).
CMD ["npx", "tsx", "proxy/src/start.ts"]
