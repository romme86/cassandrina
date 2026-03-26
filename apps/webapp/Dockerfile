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

ARG NEXT_PUBLIC_BASE_PATH=
ARG WEBAPP_EXTERNAL_URL=http://localhost:3000
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV WEBAPP_EXTERNAL_URL=${WEBAPP_EXTERNAL_URL}

WORKDIR /repo/apps/webapp
RUN pnpm build

# ── Runner (production image) ─────────────────────────────────
FROM deps AS runner

WORKDIR /repo/apps/webapp

ARG NEXT_PUBLIC_BASE_PATH=
ARG WEBAPP_EXTERNAL_URL=http://localhost:3000
ENV NODE_ENV=production
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV WEBAPP_EXTERNAL_URL=${WEBAPP_EXTERNAL_URL}

COPY --from=builder /repo/apps/webapp/.next ./.next
COPY --from=builder /repo/apps/webapp/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
