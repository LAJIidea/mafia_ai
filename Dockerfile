# ---- 阶段1：构建前端 ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- 阶段2：构建后端 ----
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# ---- 阶段3：生产运行 ----
FROM node:22-alpine
WORKDIR /app

# 只复制后端生产依赖
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev

# 复制后端编译产物
COPY --from=server-build /app/server/dist ./server/dist

# 复制前端构建产物
COPY --from=client-build /app/client/dist ./client/dist

# TTS 音频缓存目录 + 日志目录
RUN mkdir -p /app/audio_cache /app/server/logs

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
