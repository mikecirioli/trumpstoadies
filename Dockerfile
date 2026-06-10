FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM nginx:alpine

# Install Node.js and cron
RUN apk add --no-cache nodejs npm dcron

# Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# App — ingestion pipeline
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY ingest_vote.js check_new_votes.js enrich_pending.js enrich_events.js generate_rankings.js ./
COPY legislators-current.yaml ./
# Full Astro source so cron can rebuild after ingesting new votes.
# src/data/ is bind-mounted from the host at runtime and overlays this copy.
COPY astro.config.mjs tsconfig.json ./
COPY src/ ./src/

# Cron jobs:
#   - Vote ingestion: 4x/day at 00:00, 06:00, 12:00, 18:00 UTC
#   - Enrichment check: every 15 min (no-ops immediately if laptop is offline)
RUN printf '%s\n' \
    "0 0,6,12,18 * * * /usr/bin/node /app/check_new_votes.js >> /app/state/.ingest.log 2>&1" \
    "*/15 * * * * /usr/bin/node /app/enrich_pending.js >> /app/state/.ingest.log 2>&1" \
    > /etc/crontabs/root

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
CMD ["/docker-entrypoint.sh"]
