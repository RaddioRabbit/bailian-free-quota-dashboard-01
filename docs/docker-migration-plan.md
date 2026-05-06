# Next.js 前端 Docker 化迁移规划

> **范围**：只 Docker 化 Next.js 前端服务，Playwright 浏览器抓取继续在本机运行。

---

## 1. 目标

将 Next.js 前端服务容器化，同时保留 Playwright 抓取逻辑在本机执行。两者通过文件共享目录协同工作。

---

## 2. 架构设计

```
┌─────────────────────────────────────────────┐
│                  宿主机                        │
│  ┌─────────────────┐  ┌──────────────────┐  │
│  │  Next.js 容器    │  │  Playwright      │  │
│  │  (Docker)       │  │  (本机 node)      │  │
│  │  端口 3010      │  │  生成 session    │  │
│  │  读取数据文件   │◄─┤  写入 quota 数据  │  │
│  └─────────────────┘  └──────────────────┘  │
│                                              │
│  共享: ./data/ 目录 (Docker volume 挂载)    │
└─────────────────────────────────────────────┘
```

**协同方式**：
- 本机 Playwright 抓取完成后，将数据写入 `./data/quotas.json`
- Docker 容器通过 volume 挂载 `./data` 目录，前端页面读取该文件展示
- `.session.json` 保留在本机，不进入容器

---

## 3. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 基础镜像 | `node:20-alpine` | 体积小 (~180MB)，足够运行 Next.js |
| 构建策略 | 多阶段构建 | 最终镜像只含产物和 node_modules |
| 进程管理 | `next start` | 生产模式，配合 `output: 'standalone'` |
| 数据共享 | Docker bind volume | 本机 `./data` ↔ 容器 `/app/data` |
| 端口映射 | `3010:3010` | 与当前端口一致 |

---

## 4. 需要改动的代码

### 4.1 `next.config.mjs` — 开启 standalone 输出

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};

export default nextConfig;
```

### 4.2 数据读取路径 — 改为从共享目录读取

```ts
// lib/data/loader.ts（示例）
const DATA_DIR = process.env.DATA_DIR || './data';
// 读取 ${DATA_DIR}/quotas.json
```

### 4.3 `package.json`

- Playwright 依赖可以保持不动，构建时 `npm install` 会安装但不影响前端运行
- 如需精简镜像，可将 `playwright` 移入 `optionalDependencies`

---

## 5. 文件清单

```
bailian-dashboard/
├── Dockerfile              # 前端容器定义
├── docker-compose.yml      # 可选，方便启动
├── .dockerignore           # 排除不需要的文件
├── next.config.mjs         # 修改：添加 output: 'standalone'
├── data/                   # 新建：数据共享目录
│   └── quotas.json         # Playwright 写入，容器读取
└── lib/data/
    └── loader.ts           # 修改：从 DATA_DIR 读取
```

---

## 6. 实施步骤

| 阶段 | 任务 | 预估时间 |
|---|---|---|
| **Phase 1** | 修改 `next.config.mjs` 开启 standalone | 5 min |
| **Phase 2** | 创建 `data/` 目录，修改数据读取路径 | 15 min |
| **Phase 3** | 编写 `Dockerfile` + `.dockerignore` | 20 min |
| **Phase 4** | 编写 `docker-compose.yml` | 10 min |
| **Phase 5** | 本地测试：构建镜像 → 启动容器 → 验证数据展示 | 20 min |
| **Phase 6** | 更新 README，文档化启动方式 | 10 min |

**总预估：约 1.5 小时**

---

## 7. Dockerfile

```dockerfile
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

# 只拷贝 standalone 产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 数据目录（运行时挂载）
RUN mkdir -p /app/data

EXPOSE 3010
CMD ["node", "server.js"]
```

---

## 8. docker-compose.yml

```yaml
version: '3.8'
services:
  dashboard:
    build: .
    ports:
      - "3010:3010"
    volumes:
      - ./data:/app/data:ro  # 只读挂载，容器读、本机写
    environment:
      - DATA_DIR=/app/data
    restart: unless-stopped
```

---

## 9. .dockerignore

```
node_modules
.next
.git
.session.json
.data
.env.local
.DS_Store
```

---

## 10. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Playwright 抓取失败，数据文件不存在 | 前端展示空数据 | 前端加空状态提示，提示用户运行本机抓取 |
| `.session.json` 过期 | 抓取中断 | 本机保留 `npm run login` 脚本，过期后重新登录 |
| Docker 镜像构建慢 | 首次体验差 | 使用 `npm ci` 缓存 layer，国内可加 npm registry 镜像 |
| 数据文件并发写 | 数据损坏 | Playwright 写入临时文件再原子重命名 |

---

## 11. 启动方式对比

| 场景 | 命令 |
|---|---|
| 本机开发（现状） | `npm run dev` |
| 本机开发（Docker） | `docker-compose up --build` |
| 生产部署（服务器） | `docker-compose up -d` |

---

## 12. 验收标准

- [ ] `docker build .` 成功，镜像体积 < 500MB
- [ ] `docker-compose up` 后访问 `localhost:3010` 正常
- [ ] 本机 Playwright 抓取后，前端能展示最新数据
- [ ] 容器重启后数据不丢失（volume 持久化）
- [ ] 不改动 Playwright 抓取逻辑
