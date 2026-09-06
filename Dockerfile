# syncsofa runs as a single long-lived Node process (Express + one WebSocket
# per participant + SQLite on disk) — not a serverless function. See the
# README "Deploy" section for why Vercel/Netlify-style hosts can't run this.

FROM node:20-slim AS build
WORKDIR /app

# better-sqlite3 is a native module. Prebuilt binaries usually cover slim's
# glibc/amd64/arm64, but keep the node-gyp fallback toolchain around in case
# none matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy just the manifests first so `npm ci` is cached across source changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY shared shared
COPY server server
COPY client client
RUN npm run build -w client

# ---

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/syncsofa.db
WORKDIR /app

# ponytail: shipping the full node_modules (incl. devDependencies) rather
# than a `--omit=dev` prune. The server's start script runs via `tsx`
# (server/package.json), which is a devDependency, and there's no compiled
# server dist — so tsx and the TypeScript sources must survive into the
# runtime image. A true prod-only image would mean moving tsx/typescript to
# "dependencies", which is an app-source change out of scope here.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/client/package.json client/package.json
COPY --from=build /app/client/dist client/dist

# /data is where a mounted volume (Fly/Railway/Render) should land so
# DB_PATH's default survives container restarts and redeploys.
RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
