# 阶段1：构建
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: 跳过 postinstall 钩子（容器内不需要 Playwright 浏览器，
# 抓取脚本只在宿主机运行，可节省 ~250MB 镜像体积和构建时间）
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# 阶段2：运行
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3010
ENV HOSTNAME=0.0.0.0

# 只拷贝 standalone 产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# public 目录可能不存在（本项目无静态公共资源）
RUN if [ -d /app/public ]; then cp -r /app/public ./public; fi

# 数据目录（运行时通过 volume 挂载，宿主机与容器共享）
RUN mkdir -p /app/data

# 健康检查：每 30 秒检查一次，超时 3 秒，连续 3 次失败才判定为不健康
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3010/api/auth || exit 1

EXPOSE 3010
CMD ["node", "server.js"]
