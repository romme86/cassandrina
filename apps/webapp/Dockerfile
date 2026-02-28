FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /repo

# Copy workspace config
COPY pnpm-workspace.yaml package.json turbo.json ./

# Copy package manifests for caching
COPY apps/webapp/package.json ./apps/webapp/
COPY packages/shared/package.json ./packages/shared/

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/webapp/ ./apps/webapp/
COPY packages/shared/ ./packages/shared/

WORKDIR /repo/apps/webapp

RUN pnpm build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /repo/apps/webapp/.next/standalone ./
COPY --from=base /repo/apps/webapp/.next/static ./.next/static
COPY --from=base /repo/apps/webapp/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
