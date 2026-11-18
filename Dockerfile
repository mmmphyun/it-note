# syntax=docker/dockerfile:1
# 잇적(It!note) Multi-stage Dockerfile
# 프론트엔드(Svelte 5) 빌드 산출물을 백엔드(Hono + tsx)가 단일 포트(8787)에서 통합 서빙

# Stage 1: 프론트엔드 정적 빌드
FROM node:22-alpine AS web-builder
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
RUN npm ci

COPY tsconfig*.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/
RUN npm run --workspace=apps/web build

# Stage 2: 프로덕션 런너 (단일 컨테이너)
FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
RUN npm ci

ENV NODE_ENV=production
ENV PORT=8787

COPY tsconfig*.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist

EXPOSE 8787
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/server/src/index.ts"]
