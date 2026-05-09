# ─── Stage 1: deps ───
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# ─── Stage 2: build ───
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY tsconfig.base.json package.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

# ─── Stage 3: runtime ───
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/
COPY --from=build /app/client/dist ./client/dist
# Production deps only
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --workspace server --include-workspace-root --no-audit --no-fund
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
