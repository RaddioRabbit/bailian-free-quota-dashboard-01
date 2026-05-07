# Bailian Free Quota Dashboard · 阿里云百炼免费额度面板

> 面向阿里云百炼用户的本地额度监控 Dashboard。
> 登录阿里云账号后，自动抓取模型广场免费额度、剩余额度和过期时间。
> 本地开发模式由 Next.js 进程直接运行 Playwright；Docker 模式通过宿主机 `fetch-watcher` 桥接登录和抓取。

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14.2-black?logo=nextdotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-1.59-2EAD33?logo=playwright&logoColor=white">
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-supported-2496ED?logo=docker&logoColor=white">
</p>

---

## 目录

- [项目简介](#项目简介)
- [核心架构：宿主机抓取桥接](#核心架构宿主机抓取桥接)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [开发指南](#开发指南)
- [API 路由概览](#api-路由概览)
- [核心使用流程](#核心使用流程)
- [故障排查 / FAQ](#故障排查--faq)

---

## 项目简介

Bailian Free Quota Dashboard 把「登录阿里云账号 → 配置模型广场范围 → 抓取免费额度 → 本地查看和筛选」整理成一个轻量面板。

当前仓库已包含一份本地抓取样例数据：`data/quotas.json` 中有 42 个模型额度记录，覆盖 Qwen、DeepSeek、Moonshot AI、Zhipu AI、happyhorse 等 Provider，最后更新时间为 `2026-05-07T12:12:36.504Z`。

核心价值：

- **少操作**：登录一次后复用本地 `.session.json`，后续直接刷新额度数据
- **可控范围**：通过 `/source-config` 保存模型广场 URL，只抓取你关心的 Provider / 能力标签
- **Docker 可长期运行**：前端在容器中展示，Playwright 留在宿主机运行，避免容器内浏览器和登录弹窗问题

---

## 核心架构：宿主机抓取桥接

Docker 容器无法可靠弹出宿主机浏览器，因此项目把展示和抓取拆开：

```text
容器: Next.js Dashboard
  → POST /api/auth (action=login) 或 POST /api/fetch-data
  → 写 data/.fetch-trigger.json (pending, intent=login/fetch)
  → 轮询触发文件直到 done/error
  → 将抓取结果直接返回前端

宿主机: npm run fetch-watcher
  → 监听 data/.fetch-trigger.json
  → pending → running → done/error
  → 用 Playwright 完成登录或抓取
  → 写 data/quotas.json
  → 写 data/.session-status.json
```

### 关键状态文件

| 文件 | 作用 | 是否提交 |
|------|------|----------|
| `.session.json` | Playwright 保存的阿里云登录态 | 否 |
| `data/quotas.json` | Dashboard 展示的额度数据 | 是 |
| `data/.source-config.json` | 本地抓取范围配置 | 否 |
| `data/.fetch-trigger.json` | Docker 容器与宿主机 watcher 的任务触发文件 | 运行时文件 |
| `data/.session-status.json` | watcher 写入的真实登录态，供容器 `/api/auth` 读取 | 是 |

### 触发状态机

```text
(无触发文件)
      │
      ▼
pending ── watcher 接手 ──▶ running ── 抓取成功 ──▶ done
                                      └─ 抓取失败 ──▶ error
```

`pending` / `running` 超过 10 分钟会被视为僵尸任务，watcher 会标记为 `error`，避免刷新请求一直卡住。

---

## 功能特性

### 额度查看

- 查看 Qwen、DeepSeek、Moonshot AI、Zhipu AI、happyhorse 等模型的免费额度和过期时间
- 展示总额度、已用额度、剩余额度、过期时间和模型能力标签
- 自动过滤已过期模型

### 搜索、筛选和排序

| 能力 | 说明 |
|------|------|
| 搜索 | 按模型名、Provider、描述、能力标签过滤 |
| 快捷筛选 | 全部 / 即将过期 / 额度紧张 |
| 排序 | 按名称、过期时间、剩余额度排序 |
| 响应式展示 | 桌面表格 + 移动端卡片列表 |

### 抓取配置

- 在 `/source-config` 粘贴阿里云百炼模型广场 URL
- 支持多条 URL，每行一条
- 多个页面结果取并集，再按 URL 中的 Provider 参数过滤
- 保存配置后跳转首页并触发刷新

### 登录和刷新

- 本地开发模式：Next.js 进程直接调用 Playwright 弹出 Chromium
- Docker 模式：容器写触发文件，宿主机 watcher 弹出 Chromium
- 刷新中使用固定 toast 状态，重复点击不会启动多个抓取任务
- `/api/auth` 禁用缓存，避免 Docker 模式登录态回潮

---

## 技术栈

> 表中只列出当前代码实际使用的主要依赖和运行组件。

| 分类 | 选型 |
|------|------|
| **应用框架** | Next.js 14 App Router |
| **前端** | React 18 · TypeScript 5 |
| **样式** | Tailwind CSS 3.4 · shadcn/ui 风格组件 · `tailwindcss-animate` |
| **图标 / 通知** | `lucide-react` · `sonner` |
| **浏览器自动化** | Playwright Chromium |
| **数据解析** | `cheerio` · 百炼控制台 API 响应解析 |
| **数据存储** | 本地 JSON 文件：`data/quotas.json`、`data/.source-config.json`、`data/.session-status.json` |
| **部署** | Dockerfile · docker-compose · 宿主机 watcher 桥接 |

---

## 项目结构

```text
.
├── app/
│   ├── api/
│   │   ├── auth/route.ts              # 登录态检查、登录/退出/清缓存
│   │   ├── fetch-data/route.ts        # 手动刷新；direct/trigger 两种模式
│   │   ├── models/route.ts            # Dashboard 数据读取与 API Key 兜底
│   │   └── source-config/route.ts     # 抓取范围配置
│   ├── source-config/page.tsx         # 抓取配置页面
│   ├── page.tsx                       # Dashboard 首页
│   └── layout.tsx
│
├── components/
│   ├── dashboard/                     # Dashboard 页面组件
│   │   ├── dashboard-content.tsx
│   │   ├── header.tsx
│   │   ├── model-table.tsx
│   │   ├── model-card-list.tsx
│   │   ├── toolbar.tsx
│   │   └── source-config-page.tsx
│   └── ui/                            # 本地 UI 基础组件
│
├── lib/
│   ├── data/
│   │   ├── api.ts                     # Dashboard 数据入口、缓存与过滤
│   │   ├── console-scraper.ts         # Playwright 控制台抓取
│   │   ├── fetch-trigger.ts           # Docker 触发文件状态机
│   │   ├── file-loader.ts             # 本地额度文件读取
│   │   ├── model-filters.ts           # Provider / 过期模型过滤
│   │   ├── session-status.ts          # Docker 登录态共享文件
│   │   └── source-config.ts           # 抓取 URL 配置
│   └── utils/
│
├── scripts/
│   └── fetch-watcher.ts               # Docker 模式宿主机 watcher
│
├── data/
│   ├── quotas.json                    # 当前额度数据
│   └── .session-status.json           # watcher 写入的登录态
│
├── Dockerfile
├── docker-compose.yml
├── next.config.mjs
├── tailwind.config.ts
└── package.json
```

---

## 快速开始

### 环境要求

- **Node.js** ≥ 20
- **npm**
- **Docker Desktop**（仅 Docker 部署需要）

### 本地开发运行

```bash
# 1. 克隆仓库
git clone <repo-url>
cd bailian-dashboard

# 2. 安装依赖；postinstall 会下载 Playwright Chromium
npm install

# 3. 启动开发服务器
npm run dev
```

打开浏览器访问 [http://localhost:3010](http://localhost:3010)。

首次使用：

1. 点击「登录阿里云账号」
2. 在弹出的 Chromium 中完成阿里云登录
3. 进入「抓取配置」，粘贴模型广场 URL
4. 点击「保存并开始抓取」
5. 回到首页查看额度数据

### Docker 长期运行

```bash
# 1. 启动容器
docker-compose up -d --build

# 2. 宿主机安装抓取依赖
npm install

# 3. 宿主机常驻 watcher
npm run fetch-watcher
```

打开 [http://localhost:3010](http://localhost:3010)。Docker 模式下，登录和刷新都依赖宿主机 watcher；不运行 watcher 时，刷新会等待到超时。

## 环境变量

复制 `.env.example` 为 `.env.local` 后按需配置：

```bash
cp .env.example .env.local
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DASHSCOPE_API_KEY` | 无 | 备用 API Key 查询路径；额度查询能力受 DashScope API 限制，推荐使用登录抓取 |
| `DATA_DIR` | `./data` | 数据文件目录；Docker 中为 `/app/data` |
| `FETCH_MODE` | direct | 设为 `trigger` 时，`/api/fetch-data` 通过 watcher 触发抓取 |
| `DEBUG_BAILIAN` | 无 | 设为 `1` 时，输出更详细的控制台抓取日志 |
| `PLAYWRIGHT_CHROMIUM_PATH` | Playwright 默认路径 | 指定 Chromium 可执行文件路径 |

> 日常使用推荐「阿里云账号登录 + Playwright 抓取」。`DASHSCOPE_API_KEY` 只是备用路径，无法保证拿到完整免费额度信息。

---

## 开发指南

### npm scripts 一览

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Next.js 开发服务器（端口 3010） |
| `npm run build` | 构建生产版本 |
| `npm run start` | 启动生产服务器（端口 3010） |
| `npm run lint` | 运行 Next.js ESLint 检查 |
| `npm run fetch-watcher` | Docker 模式宿主机 watcher |

### 构建与检查

```bash
npm run build
npm run lint
npx tsc --noEmit
```

### Docker 配置要点

`docker-compose.yml` 中的关键配置：

- `3010:3010`：Dashboard 访问端口
- `./data:/app/data:rw`：容器和宿主机共享数据目录
- `DATA_DIR=/app/data`：容器内读取共享数据
- `FETCH_MODE=trigger`：容器通过触发文件请求宿主机抓取
- healthcheck：访问 `http://127.0.0.1:3010/api/auth`

---

## API 路由概览

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/models` | GET | 读取 Dashboard 数据；优先使用 session / 文件数据，可 fallback 到 API Key 路径 |
| `/api/models` | POST | `verify` 验证 API Key；`refresh` 清缓存后重新读取 |
| `/api/auth` | GET | 查询登录态；Docker 模式优先读取 `data/.session-status.json` |
| `/api/auth` | POST | `login` / `logout` / `refresh` |
| `/api/fetch-data` | GET | 查看当前抓取模式和运行状态 |
| `/api/fetch-data` | POST | 触发一次额度抓取；direct 模式直接抓，trigger 模式写触发文件 |
| `/api/source-config` | GET | 读取抓取页面 URL 配置 |
| `/api/source-config` | POST | 保存抓取页面 URL，并清理 Dashboard 缓存 |

---

## 核心使用流程

1. **登录阿里云账号**：本地模式直接弹 Chromium；Docker 模式由 watcher 弹 Chromium
2. **配置抓取范围**：在百炼模型广场筛选 Provider / 能力标签，复制 URL 到 `/source-config`
3. **保存并刷新**：保存配置后回到首页，触发 `/api/fetch-data`
4. **Playwright 抓取**：访问模型广场页面和模型详情，解析免费额度、剩余额度和过期时间
5. **写入本地数据**：抓取结果写入 `data/quotas.json`
6. **前端展示**：Dashboard 按搜索、筛选、排序展示结果
7. **后续维护**：手动点击「刷新」，由本地服务或 Docker watcher 完成抓取

---

## 故障排查 / FAQ

<details>
<summary><b>Q1：提示 Chromium 未找到或 Executable doesn't exist？</b></summary>

`npm install` 的 `postinstall` 会自动执行 `playwright install chromium`。如果下载失败，在项目目录手动运行：

```bash
npx playwright install chromium
```

</details>

<details>
<summary><b>Q2：Docker 模式点击刷新后等待 watcher 超时？</b></summary>

宿主机没有运行 watcher，或容器没有权限写共享目录。打开一个宿主机终端并保持运行：

```bash
npm run fetch-watcher
```

同时确认 `docker-compose.yml` 中存在 `./data:/app/data:rw`。

</details>

<details>
<summary><b>Q3：Docker 模式页面显示未登录？</b></summary>

先看 `data/.session-status.json`。如果 `valid` 为 `false`，说明 watcher 没找到 session 或确认 session 过期。点击「登录阿里云账号」重新认证；如果文件不存在，先启动 `npm run fetch-watcher`。

</details>

<details>
<summary><b>Q4：登录后刷新仍然没有数据？</b></summary>

确认已经在 `/source-config` 保存过至少一条百炼模型广场 URL。没有来源配置时，抓取接口会返回「请先在 /source-config 配置要抓取的模型广场页面」。

</details>

<details>
<summary><b>Q5：Session 多久会过期？</b></summary>

取决于阿里云账号登录态。过期后点击「退出登录」再点击「登录阿里云账号」，让 watcher 或本地 Playwright 重新写入 `.session.json`。

</details>
