# Image for the bemodi fork, built straight from git (e.g. by Coolify, build pack "Dockerfile").
# Unlike docker/dockerfile, it builds the frontend itself, so no prebuilt dist/ is needed.
# The last stage is the image; no build target has to be selected.
#
#   docker build -f docker/bemodi.dockerfile -t uptime-kuma-bemodi .

############################################
# Healthcheck binary (prebuilt by upstream)
############################################
FROM louislam/uptime-kuma:builder-go3 AS build_healthcheck

############################################
# Frontend (needs the dev dependencies)
############################################
FROM louislam/uptime-kuma:base3 AS build_frontend
USER node
WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --chown=node:node .npmrc package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build

############################################
# Server (production dependencies only)
############################################
FROM louislam/uptime-kuma:base3 AS build
USER node
WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --chown=node:node .npmrc package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
COPY --chown=node:node --from=build_frontend /app/dist /app/dist
COPY --chown=node:node --from=build_healthcheck /app/extra/healthcheck /app/extra/healthcheck
RUN mkdir -p ./data

############################################
# Image
############################################
FROM louislam/uptime-kuma:base3 AS release
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/bemodi/uptime-kuma"

ENV UPTIME_KUMA_IS_CONTAINER=1
ENV NODE_ENV=production

COPY --chown=node:node --from=build /app /app

EXPOSE 3001
HEALTHCHECK --interval=60s --timeout=30s --start-period=180s --retries=5 CMD extra/healthcheck
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--import=tsx", "server/server.js"]
