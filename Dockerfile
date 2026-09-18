# Matchr API + admin console, in one image.
#
# The console is served by the API at /admin from the same origin, so it needs
# no CORS entry and no second service. It is built here rather than committed,
# and it carries no build-time environment: the API serves /admin/env.js from
# its own process env, so this exact image runs in every environment.
#
# Railway: set the service's Root Directory to "/" and Dockerfile Path to
# "Dockerfile". The build context must be the repo root so that admin/ is
# visible; backend/Dockerfile is kept for backend/docker-compose.yml.

# ── 1. Build the console ──────────────────────────────────────────
FROM node:22-alpine AS admin
WORKDIR /admin
# Copied separately so a change to the source does not re-run npm ci.
COPY admin/package.json admin/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY admin/ ./
RUN npm run build

# ── 2. The API ────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY backend/ ./

# express.static serves this at /admin; when it is absent the API still boots
# and /admin reports that the panel is not built in this deployment.
COPY --from=admin /admin/dist ./public/admin

EXPOSE 3000

# Migrations run on every boot, before the server starts listening.
CMD ["npm", "start"]
