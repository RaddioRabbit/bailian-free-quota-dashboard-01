# Bailian Free Quota Dashboard

> 阿里云百炼模型广场免费额度查看面板

一个用于查看阿里云百炼模型广场免费额度、过期时间和剩余额度的轻量化 Dashboard。登录阿里云账号后可拉取真实数据，通过搜索、筛选、排序快速定位即将过期或额度紧张的模型。

## 功能

- 查看 Qwen、DeepSeek、MiniMax、Moonshot、Zhipu 等主流模型的免费额度和过期时间
- 按"即将过期""额度紧张"等条件快速筛选
- 按名称、过期时间、剩余额度排序，支持搜索模型名
- 登录阿里云账号后拉取真实数据（Playwright 自动化）
- 自定义抓取范围：配置要监控的模型广场页面 URL
- 数据本地缓存（默认 5 分钟），支持手动刷新
- 支持 Docker 部署，前后端分离运行

## 环境要求

- Node.js 18+
- npm
- Docker Desktop（Docker 部署方式需要）

## 安装

```bash
# 1. 克隆仓库
git clone <repo-url>
cd bailian-dashboard

# 2. 安装依赖（postinstall 钩子会自动下载 Chromium 浏览器）
npm install
```

> **说明**：`npm install` 完成后，`postinstall` 钩子会自动执行 `playwright install chromium`，
> 下载 Chromium 浏览器到 `~/Library/Caches/ms-playwright/`（约 250MB）。
> 如自动下载失败，可手动执行：`npx playwright install chromium`

## 使用

### 方式一：本地开发运行（推荐初次使用）

#### 1. 启动应用

```bash
npm run dev
```

打开浏览器访问 [http://localhost:3010](http://localhost:3010)。

#### 2. 登录阿里云账号

初次使用需要登录，点击页面右上角的「**登录阿里云账号**」按钮：

1. 系统自动弹出 Chromium 浏览器窗口
2. 在弹出窗口中完成阿里云登录（支持密码、扫码等方式）
3. 登录成功后，关闭或保留弹出窗口，回到 Dashboard
4. 点击「**刷新**」按钮，Dashboard 开始拉取真实额度数据

> Session 保存在本地 `.session.json`（已加入 `.gitignore`，不会提交到 Git）。
> 此后每次重启应用都会自动复用已保存的 session，无需重复登录。

#### 3. 配置抓取范围（可选）

登录后，点击「**抓取配置**」可自定义要监控的模型范围：

1. 在 [阿里云百炼模型广场](https://bailian.console.aliyun.com/cn-beijing#/model-market/all) 筛选你关注的 Provider 和能力标签

2. 复制浏览器地址栏中的完整 URL

3. 粘贴到抓取配置页面，点击「**保存并开始抓取**」

支持填写多条 URL（每行一条），系统会对多条页面的结果取并集。

**URL 示例：**

```
https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen%2Cmini-max%2Cmoonshot-ai%2Czhipu-ai%2Cdeepseek&capabilities=TG%2CReasoning%2CVU
```

#### 4. 日常使用

- 点击「**刷新**」手动更新数据（数据默认缓存 5 分钟）
- 使用顶部搜索框按模型名过滤
- 使用筛选按钮查看「即将过期」或「额度紧张」的模型
- 点击列标题可按名称、过期时间、剩余额度排序

---

### 方式二：Docker 部署（推荐长期运行）

架构说明：Next.js 前端运行在 Docker 容器中，Playwright 抓取继续在宿主机（本机）运行，通过共享 `./data` 目录交换数据。

> **重要**：Docker 容器只负责展示数据与转发请求，登录和抓取必须在宿主机完成。点击页面「**刷新**」按钮时，容器会写入 `data/.fetch-trigger.json` 触发文件，**宿主机的 `npm run fetch-watcher` 守护进程**读取文件后调用 Playwright 完成抓取，结果写回 `data/quotas.json`。

#### 完整使用流程（新电脑首次）

**Step 1：启动 Docker 容器**

```bash
docker-compose up -d --build
```

浏览器访问 http://localhost:3010，此时页面显示「暂无数据」。

**Step 2：宿主机安装抓取环境**

```bash
# 安装项目依赖（postinstall 钩子会自动下载 Chromium 浏览器）
npm install
```

> 如果 Chromium 自动下载失败，可手动执行：`npx playwright install chromium`

**Step 3：启动宿主机 watcher 守护进程**（关键）

打开一个新终端，常驻运行：

```bash
npm run fetch-watcher
```

> watcher 会监听 `data/.fetch-trigger.json`，容器侧每次点击「刷新」即触发本进程执行抓取。
> 不启动 watcher 的话，页面点击「刷新」会提示"等待宿主机 watcher 处理超时"。

**Step 4：配置抓取页面（可选）**

项目已自带默认的模型广场链接。如需调整，访问 http://localhost:3010/source-config，粘贴阿里云百炼模型广场页面的 URL。

**Step 5：在页面上点击「刷新」完成首次登录与抓取**

回到浏览器 http://localhost:3010，点击右上角「**刷新**」按钮：

1. 页面提示"正在抓取最新额度数据，预计 30-60 秒…"
2. 宿主机 watcher 检测到无 session → 自动弹出 Chromium 浏览器
3. 在弹出窗口中完成阿里云登录（密码或扫码）
4. 登录完成后**手动关闭浏览器窗口**，watcher 自动继续抓取
5. 页面自动收到 toast：`已更新 X 个模型，耗时 Y 秒`，列表立即刷新

#### 日常刷新数据

直接点击页面上的「**刷新**」按钮即可。watcher 保持运行的情况下，每次刷新都会自动抓取最新数据并更新页面。

也可以手动跑一次（不依赖页面按钮）：

```bash
npm run fetch-data
```

---

`docker-compose.yml` 关键配置：

- 端口映射 `3010:3010`
- 共享卷 `./data:/app/data:rw`（容器需写入 `.fetch-trigger.json` 触发文件）
- 环境变量 `DATA_DIR=/app/data`、`FETCH_MODE=trigger`（启用 watcher 桥接）

---

### 独立数据抓取脚本

```bash
npm run fetch-data
```

这是独立脚本，不启动前端服务器，直接调用 Playwright 抓取并写入 `./data/quotas.json`。

**使用场景：**

- **Docker 模式下更新数据的唯一方式**（容器内无法运行浏览器）
- 前端在 Docker 运行时，避免端口冲突
- 定时自动抓取数据

**脚本流程：**

1. 检查 session → 没有则弹出浏览器登录
2. 抓取模型额度
3. 写入 `data/quotas.json`

支持自动重试：session 过期时会自动重新登录并再次抓取。

---

### macOS 自动定时抓取（可选）

使用 launchd 每隔一段时间自动运行 `npm run fetch-data`：

```bash
cat > ~/Library/LaunchAgents/com.bailian.fetch.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bailian.fetch</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-c</string>
        <string>cd /Users/mima0000/Desktop/WorkplaceAgent/LiweiAgent/UsageAgent/bailian-dashboard_01 && /usr/local/bin/npm run fetch-data</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>/tmp/bailian-fetch.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/bailian-fetch.err.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.bailian.fetch.plist
launchctl start com.bailian.fetch
```

建议间隔 30 分钟（1800 秒）或 1 小时（3600 秒）。

如需停止定时任务：

```bash
launchctl stop com.bailian.fetch
launchctl unload ~/Library/LaunchAgents/com.bailian.fetch.plist
```

---

### 迁移到新电脑

#### Docker 模式（推荐）

1. 安装 Docker Desktop
2. 复制项目文件夹（建议带上 `data/quotas.json` 和 `.session.json`，避免重新登录和配置）
3. `docker-compose up -d --build`
4. 宿主机另开终端：`npm install && npm run fetch-watcher`
5. 浏览器访问 http://localhost:3010
6. 数据过期或想强制刷新，直接点页面右上角「**刷新**」按钮

> 全新电脑没有 Node.js 时，需要先安装 Node.js 20+，再执行 `npm install`（postinstall 自动下载 Chromium），最后启动 `npm run fetch-watcher` 守护进程。

#### 本地模式

1. 安装 Node.js 20+
2. 复制项目文件夹（带上 `data/quotas.json` 和 `.session.json`）
3. `npm install`（postinstall 自动下载 Chromium）
4. `npm run dev`
5. 浏览器访问 http://localhost:3010
6. 如果 source-config 配置丢失，访问 `/source-config` 重新粘贴模型广场 URL

---

## 环境变量（可选）

复制 `.env.example` 为 `.env.local` 进行配置（均为可选项）：

```bash
cp .env.example .env.local
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DASHSCOPE_API_KEY` | DashScope API Key（`sk-xxx`），用于 API 方式查询，实际效果受限 | 无 |
| `CACHE_TTL` | 数据缓存时长（毫秒） | `300000`（5 分钟） |
| `DATA_DIR` | 数据文件目录（Docker 模式使用） | 无 |

> 推荐使用**登录方式**而非 API Key，登录方式可以获取完整的免费额度信息。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口 3010） |
| `npm run build` | 构建生产版本 |
| `npm run start` | 启动生产服务器（端口 3010） |
| `npm run lint` | 运行 ESLint 检查 |
| `npm run fetch-data` | 独立数据抓取（不启动前端） |
| `npm run fetch-watcher` | Docker 模式下的宿主机 watcher 守护进程 |

## 工作原理

应用通过 Playwright 控制 Chromium 浏览器，复用已保存的阿里云 session，自动访问百炼控制台的各模型详情页，抓取免费额度、剩余量和过期时间等信息。

数据流（本地模式）：

```
Dashboard UI
  → GET /api/models
    → console-scraper (Playwright + .session.json)
      → 阿里云百炼控制台 API
```

数据流（Docker 模式）：

```
宿主机: npm run fetch-watcher（守护进程，监听触发文件）
                    ↑ ↓
                    | | 写 data/quotas.json
                    | |
容器: Dashboard UI 点击「刷新」
  → POST /api/fetch-data
    → 写 data/.fetch-trigger.json (status: pending)
    → 轮询触发文件直到 done/error
    → 返回结果给前端
```

也支持宿主机手动直接跑 `npm run fetch-data` 一次性抓取（不经容器，直接写 `data/quotas.json`）。

### 自动刷新说明

页面每 5 分钟自动静默重新读取一次 `data/quotas.json`，但这只是重新读文件，不会触发 Playwright 抓取。

数据真正的更新由以下两种方式触发：

- **本地 Dev 模式**：页面点击「刷新」→ `/api/fetch-data` 直接执行抓取
- **Docker 模式**：页面点击「刷新」→ 容器写触发文件 → 宿主机 `npm run fetch-watcher` 守护进程执行抓取

也可以随时在宿主机手动跑 `npm run fetch-data` 一次性抓取。

## 常见问题

**Q: 登录后刷新仍然显示空数据？**
A: 确认登录时在弹出窗口中已完全通过阿里云认证（密码 + 短信验证码 / 扫码）。可尝试退出登录后重新登录。

**Q: 提示"Chromium 未找到"或"Executable doesn't exist"？**
A: 通常 `npm install` 时 postinstall 钩子会自动下载。如果失败，在项目目录执行 `npx playwright install chromium`，然后重启应用。

**Q: Session 多久会过期？**
A: 取决于阿里云账号的 session 有效期，通常为数天到数周。过期后点击「登录阿里云账号」重新登录即可。

**Q: 如何退出登录？**
A: 登录状态下，点击右上角「**退出登录**」按钮，会清除本地 session 和数据缓存。

**Q: Docker 模式下点击页面「登录」按钮没反应？**
A: Docker 容器内无法直接弹出浏览器，但点击「**刷新**」按钮时，宿主机 watcher（`npm run fetch-watcher`）会代为弹出登录窗口。所以 Docker 模式下日常使用流程是：保持 watcher 在宿主机一直运行，需要登录或刷新时直接点页面上的「刷新」按钮。

**Q: Docker 模式下页面点击「刷新」提示"等待宿主机 watcher 处理超时"？**
A: 说明宿主机没有运行 watcher 守护进程。请打开一个终端执行：`npm run fetch-watcher`，并保持运行。建议跟 Docker 容器一起常驻。

**Q: Docker 模式下页面显示"未登录"？**
A: 说明 `data/quotas.json` 不存在。点击页面右上角「**刷新**」即可触发首次登录与抓取（前提是宿主机 watcher 已运行）。也可以手动跑 `npm run fetch-data` 一次性完成。

**Q: 定时任务没有运行？**
A: 检查 plist 文件中的路径是否正确，特别是 `npm` 的绝对路径（可用 `which npm` 确认）。查看 `/tmp/bailian-fetch.err.log` 获取错误信息。
