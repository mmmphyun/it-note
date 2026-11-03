# syntax=docker/dockerfile:1
# 잇적(It!note) Multi-stage Dockerfile
# 프론트엔드(Svelte 5) 빌드 산출물을 백엔드(Hono)가 단일 포트에서 통합 서빙

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
RUN npm run --workspace=packages/shared build || true
RUN npm run --workspace=apps/web build

# Stage 2: 백엔드 TypeScript 빌드
FROM node:22-alpine AS server-builder
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/server/package*.json ./apps/server/
RUN npm ci

COPY tsconfig*.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/
RUN npm run --workspace=packages/shared build || true
RUN npm run --workspace=apps/server build

# Stage 3: 프로덕션 런너 (단일 컨테이너)
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/server/package*.json ./apps/server/
RUN npm ci --omit=dev

# 빌드 산출물 복사
COPY --from=server-builder /app/apps/server/dist ./apps/server/dist
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist
COPY packages/shared ./packages/shared

EXPOSE 8080
USER node
CMD ["node", "apps/server/dist/index.js"]
