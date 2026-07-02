# syntax=docker/dockerfile:1

# Family Guy Discord bot — small production image. Pure JS, no build step; the only
# runtime data is the committed data/*.json (subtitles/ is never needed at runtime).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Stamped by CI (see .github/workflows/bot.build.yml); harmless default for local builds.
ARG RELEASE_VERSION=0.0.0
ENV RELEASE_VERSION=$RELEASE_VERSION

# Writable per-instance state (subscribed channels) lives on a volume so it survives
# restarts; the read-only app data stays baked into the image at /app/data.
ENV SUBSCRIPTIONS_FILE=/state/subscriptions.json

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY data ./data

RUN mkdir -p /state && chown -R node:node /state
USER node
VOLUME ["/state"]

CMD ["node", "src/index.js"]
