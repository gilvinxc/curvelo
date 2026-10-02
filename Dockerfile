# Curvelo production image: Fastify API + built web client (same-origin).
# Build:  docker build -t curvelo .
# Run:    docker run -p 4000:4000 -e DATABASE_URL=... -e JWT_ACCESS_SECRET=... -e JWT_REFRESH_SECRET=... curvelo

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY . .
RUN npm run db:generate --workspace=@curvelo/api \
  && npm run build --workspace=@curvelo/shared \
  && npm run build --workspace=@curvelo/api \
  && VITE_API_URL=/api/v1 npm run build --workspace=@curvelo/web

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The start command runs `prisma` via the engines wrapper; it lives in .bin.
ENV PATH="/app/node_modules/.bin:${PATH}"

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/prisma ./packages/api/prisma
COPY --from=build /app/packages/api/scripts ./packages/api/scripts
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Serve the built web client from the API (same origin).
ENV WEB_DIST=/app/packages/web/dist

EXPOSE 4000
# Apply pending migrations, then start. Render injects PORT automatically.
CMD ["sh", "-c", "node packages/api/scripts/with-engines.mjs prisma migrate deploy --schema packages/api/prisma/schema.prisma && node packages/api/dist/index.js"]
