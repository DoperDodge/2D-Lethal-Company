# ─── Stage 1: deps ───
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# ─── Stage 2: build ───
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
COPY server/package.json server/tsconfig.json ./server/
COPY server/src ./server/src
COPY client/package.json client/tsconfig.json client/tsconfig.app.json client/tsconfig.node.json client/vite.config.ts client/index.html ./client/
COPY client/src ./client/src
COPY client/public ./client/public
RUN npm run build

# ─── Stage 3: runtime ───
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Workspace metadata for npm to validate the tree
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install prod-only deps (server's express+ws; shared has no runtime deps;
# client's react/etc are dev-only since the client is served as static dist)
RUN npm install --omit=dev --workspace server --include-workspace-root --no-audit --no-fund

# Built artifacts
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
