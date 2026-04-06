# Bailian Free Quota Dashboard

> 阿里云百炼模型广场免费额度查看面板

一个用于查看阿里云百炼模型广场免费额度、过期时间和剩余额度的轻量化 Dashboard。登录阿里云账号后可拉取真实数据，通过搜索、筛选、排序快速定位即将过期或额度紧张的模型。

![界面预览](https://bailian.console.aliyun.com/favicon.ico)

## 功能

- 查看 Qwen、DeepSeek、MiniMax、Moonshot、Zhipu 等主流模型的免费额度和过期时间
- 按"即将过期""额度紧张"等条件快速筛选
- 按名称、过期时间、剩余额度排序，支持搜索模型名
- 登录阿里云账号后拉取真实数据（Playwright 自动化）
- 自定义抓取范围：配置要监控的模型广场页面 URL
- 数据本地缓存（默认 5 分钟），支持手动刷新

## 环境要求

- Node.js 18+
- npm

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

### 1. 启动应用

```bash
npm run dev
```

打开浏览器访问 [http://localhost:3001](http://localhost:3001)。

### 2. 登录阿里云账号

初次使用需要登录，点击页面右上角的「**登录阿里云账号**」按钮：

1. 系统自动弹出 Chromium 浏览器窗口
2. 在弹出窗口中完成阿里云登录（支持密码、扫码等方式）
3. 登录成功后，关闭或保留弹出窗口，回到 Dashboard
4. 点击「**刷新**」按钮，Dashboard 开始拉取真实额度数据

> Session 保存在本地 `.session.json`（已加入 `.gitignore`，不会提交到 Git）。  
> 此后每次重启应用都会自动复用已保存的 session，无需重复登录。

### 3. 配置抓取范围（可选）

登录后，点击「**抓取配置**」可自定义要监控的模型范围：

1. 在 [阿里云百炼模型广场](https://bailian.console.aliyun.com/cn-beijing#/model-market/all) 筛选你关注的 Provider 和能力标签

2. 复制浏览器地址栏中的完整 URL

3. 粘贴到抓取配置页面，点击「**保存并开始抓取**」

支持填写多条 URL（每行一条），系统会对多条页面的结果取并集。

**URL 示例：**

```
https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen%2Cmini-max%2Cmoonshot-ai%2Czhipu-ai%2Cdeepseek&capabilities=TG%2CReasoning%2CVU
```

### 4. 日常使用

- 点击「**刷新**」手动更新数据（数据默认缓存 5 分钟）
- 使用顶部搜索框按模型名过滤
- 使用筛选按钮查看「即将过期」或「额度紧张」的模型
- 点击列标题可按名称、过期时间、剩余额度排序

## 环境变量（可选）

复制 `.env.example` 为 `.env.local` 进行配置（均为可选项）：

```bash
cp .env.example .env.local
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DASHSCOPE_API_KEY` | DashScope API Key（`sk-xxx`），用于 API 方式查询，实际效果受限 | 无 |
| `CACHE_TTL` | 数据缓存时长（毫秒） | `300000`（5 分钟） |

> 推荐使用**登录方式**而非 API Key，登录方式可以获取完整的免费额度信息。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口 3001） |
| `npm run build` | 构建生产版本 |
| `npm run start` | 启动生产服务器（端口 3001） |
| `npm run lint` | 运行 ESLint 检查 |

## 工作原理

应用通过 Playwright 控制 Chromium 浏览器，复用已保存的阿里云 session，自动访问百炼控制台的各模型详情页，抓取免费额度、剩余量和过期时间等信息。

数据流：

```
Dashboard UI
  → GET /api/models
    → console-scraper (Playwright + .session.json)
      → 阿里云百炼控制台 API
```

## 常见问题

**Q: 登录后刷新仍然显示空数据？**  
A: 确认登录时在弹出窗口中已完全通过阿里云认证（密码 + 短信验证码 / 扫码）。可尝试退出登录后重新登录。

**Q: 提示"Chromium 未找到"？**  
A: 在项目目录执行 `npx playwright install chromium`，然后重启应用。

**Q: Session 多久会过期？**  
A: 取决于阿里云账号的 session 有效期，通常为数天到数周。过期后点击「登录阿里云账号」重新登录即可。

**Q: 如何退出登录？**  
A: 登录状态下，点击右上角「**退出登录**」按钮，会清除本地 session 和数据缓存。
