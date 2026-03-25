FROM node:20-alpine AS deps

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /repo

# Copy workspace manifests (for install caching)
COPY pnpm-workspace.yaml package.json turbo.json ./
COPY apps/webapp/package.json ./apps/webapp/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (no lockfile required — dev convenience)
RUN pnpm install --no-frozen-lockfile

# ── Builder (production only) ─────────────────────────────────
FROM deps AS builder

# Copy source after deps are installed
COPY apps/webapp/ ./apps/webapp/
COPY packages/shared/ ./packages/shared/

WORKDIR /repo/apps/webapp
RUN pnpm build

# ── Runner (production image) ─────────────────────────────────
FROM deps AS runner

WORKDIR /repo/apps/webapp

ENV NODE_ENV=production

COPY --from=builder /repo/apps/webapp/.next ./.next
COPY --from=builder /repo/apps/webapp/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
