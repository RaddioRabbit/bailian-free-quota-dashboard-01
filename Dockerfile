# 阶段1：构建
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 阶段2：运行
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3010

# 只拷贝 standalone 产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# public 目录可能不存在（本项目无静态公共资源）
RUN if [ -d /app/public ]; then cp -r /app/public ./public; fi

# 数据目录（运行时挂载）
RUN mkdir -p /app/data

EXPOSE 3010
CMD ["node", "server.js"]
