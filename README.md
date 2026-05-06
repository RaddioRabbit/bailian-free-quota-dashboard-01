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

# 2. 安装依赖
npm install

# 3. 安装 Playwright Chromium（登录功能必须）
npx playwright install chromium
```

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

> **重要**：Docker 容器只负责展示数据，登录和抓取必须在宿主机完成。容器通过检查 `data/quotas.json` 文件是否存在来判断是否已登录，不读取 `.session.json`。

#### 完整使用流程（新电脑首次）

**Step 1：启动 Docker 容器**

```bash
docker-compose up -d --build
```

浏览器访问 http://localhost:3010，此时页面显示「暂无数据」。

**Step 2：宿主机安装抓取环境**

```bash
# 安装项目依赖（包含 Playwright）
npm install

# 安装 Chromium 浏览器本体
npx playwright install chromium
```

**Step 3：配置抓取页面（可选）**

项目已自带默认的模型广场链接。如需调整，访问 http://localhost:3010/source-config，粘贴阿里云百炼模型广场页面的 URL。

**Step 4：首次登录并抓取**

```bash
npm run fetch-data
```

1. 脚本检查 session → 没有则弹出 Chromium 浏览器
2. 在浏览器中完成阿里云登录（密码或扫码）
3. 登录成功后**手动关闭浏览器窗口**
4. 脚本自动抓取数据并写入 `data/quotas.json`

**Step 5：刷新页面查看**

回到浏览器，按 **F5** 刷新 http://localhost:3010，即可看到最新额度数据。

#### 日常刷新数据

```bash
npm run fetch-data
```

然后浏览器 F5 刷新页面。已有 session 时无需重复登录。

---

`docker-compose.yml` 关键配置：

- 端口映射 `3010:3010`
- 共享卷 `./data:/app/data:ro`（容器只读挂载）
- 环境变量 `DATA_DIR=/app/data`

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
4. 浏览器访问 http://localhost:3010
5. 如果数据过期，运行 `npm run fetch-data` 刷新数据，然后 F5 刷新页面

> 如果是全新电脑且没有 Node.js 环境，需要先安装 Node.js 20+，然后执行 `npm install && npx playwright install chromium`，才能运行 `npm run fetch-data`。

#### 本地模式

1. 安装 Node.js 20+
2. 复制项目文件夹（带上 `data/quotas.json` 和 `.session.json`）
3. `npm install && npx playwright install chromium`
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
宿主机: npm run fetch-data
  → Playwright 抓取 → 写入 ./data/quotas.json

容器: Dashboard UI
  → GET /api/models
    → 读取 /app/data/quotas.json（只读挂载）
```

### 自动刷新说明

页面每 5 分钟自动静默刷新一次（重新读取数据），但这只是重新读取 `data/quotas.json` 文件，不会触发 Playwright 抓取。数据更新必须依赖宿主机运行 `npm run fetch-data`。

## 常见问题

**Q: 登录后刷新仍然显示空数据？**
A: 确认登录时在弹出窗口中已完全通过阿里云认证（密码 + 短信验证码 / 扫码）。可尝试退出登录后重新登录。

**Q: 提示"Chromium 未找到"？**
A: 在项目目录执行 `npx playwright install chromium`，然后重启应用。

**Q: Session 多久会过期？**
A: 取决于阿里云账号的 session 有效期，通常为数天到数周。过期后点击「登录阿里云账号」重新登录即可。

**Q: 如何退出登录？**
A: 登录状态下，点击右上角「**退出登录**」按钮，会清除本地 session 和数据缓存。

**Q: Docker 模式下点击页面「登录」按钮没反应？**
A: Docker 容器内无法运行浏览器，页面上的登录按钮在 Docker 模式下不会生效。请在宿主机终端运行 `npm run fetch-data` 完成登录和抓取。

**Q: Docker 模式下页面显示"未登录"？**
A: 确保已在宿主机运行 `npm run fetch-data` 生成 `data/quotas.json` 文件。Docker 容器通过检查该文件判断登录状态，不读取 `.session.json`。

**Q: 定时任务没有运行？**
A: 检查 plist 文件中的路径是否正确，特别是 `npm` 的绝对路径（可用 `which npm` 确认）。查看 `/tmp/bailian-fetch.err.log` 获取错误信息。
