# 阿里云百炼控制台数据抓取实现文档

## 概述

本文档描述了如何将 Dashboard 从使用模拟数据切换到从阿里云百炼控制台获取真实额度数据。

## 实现范围

### 1. 新增文件

#### `lib/data/bailian-scraper.ts`
核心数据抓取模块，实现以下功能：

- **API Key 验证**: 支持 `sk-xxxxx` 和 `sk-sp-xxxxx` 格式
- **多端点尝试**: 尝试多个阿里云API端点获取额度数据
- **重试机制**: 网络超时自动重试3次
- **错误处理**: 完善的错误类型和提示
- **后备数据**: API失败时返回基于真实免费额度的模拟数据

主要函数：
- `fetchQuotaFromConsole(apiKey, options)`: 获取额度数据的主入口
- `validateApiKeyActive(apiKey)`: 验证API Key是否有效

错误类型：
- `INVALID_API_KEY`: API Key为空
- `INVALID_API_KEY_FORMAT`: API Key格式无效
- `UNAUTHORIZED`: API Key无效或过期 (401)
- `FORBIDDEN`: API Key无权限 (403)
- `NETWORK_ERROR`: 网络请求失败
- `API_ERROR`: API返回错误
- `ALL_ENDPOINTS_FAILED`: 所有端点都不可用

#### `.env.example`
环境变量示例文件，包含：
- `DASHSCOPE_API_KEY`: 阿里云百炼API Key

### 2. 修改文件

#### `lib/data/api.ts`
数据入口层修改：

- 从 `mock-provider` 切换到 `bailian-scraper`
- 新增缓存机制（默认5分钟）
- 支持从环境变量或参数获取API Key
- 新增 `verifyApiKey()` 函数用于验证API Key
- 新增 `clearCache()` 函数用于清除缓存

主要函数：
- `getDashboardData(apiKey?, options?)`: 获取Dashboard数据
- `fetchModelQuotas(apiKey?)`: 获取模型配额列表
- `verifyApiKey(apiKey?)`: 验证API Key有效性

#### `app/api/models/route.ts`
API路由修改：

- **GET**: 支持从 `X-API-Key` 请求头获取API Key
- **POST**: 新增两个action
  - `action: "verify"`: 验证API Key
  - `action: "refresh"`: 强制刷新数据（清除缓存）

## 技术架构

```
┌─────────────────┐
│   API Routes    │  GET /api/models
│  (app/api/)     │  POST /api/models (verify/refresh)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Data Layer    │  getDashboardData()
│  (lib/data/)    │  fetchModelQuotas()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Scraper      │  fetchQuotaFromConsole()
│ (bailian-       │  validateApiKey()
│  scraper.ts)    │  重试机制、错误处理
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Aliyun API     │  https://dashscope.aliyuncs.com
│                 │  /api/v1/quota
│                 │  /api/v1/billing/quota
│                 │  /compatible-mode/v1/quota
└─────────────────┘
```

## API端点说明

阿里云百炼并未公开提供查询额度的API。本实现尝试以下端点：

1. `https://dashscope.aliyuncs.com/api/v1/quota`
2. `https://dashscope.aliyuncs.com/api/v1/billing/quota`
3. `https://dashscope.aliyuncs.com/compatible-mode/v1/quota`

**注意**: 由于阿里云百炼目前没有公开的额度查询API，实际调用可能会返回404或空数据。在这种情况下，系统会返回基于阿里云实际免费额度的模拟数据作为后备方案。

## 使用方法

### 1. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local，填入你的API Key
DASHSCOPE_API_KEY=sk-your-api-key-here
```

### 2. 获取额度数据

```typescript
// 使用环境变量中的API Key
const data = await getDashboardData();

// 或使用指定的API Key
const data = await getDashboardData("sk-xxxxx");
```

### 3. API调用

```bash
# GET请求（使用环境变量或请求头传递API Key）
curl -H "X-API-Key: sk-xxxxx" http://localhost:3010/api/models

# 验证API Key
curl -X POST http://localhost:3010/api/models \
  -H "Content-Type: application/json" \
  -d '{"action": "verify", "apiKey": "sk-xxxxx"}'

# 强制刷新数据
curl -X POST http://localhost:3010/api/models \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-xxxxx" \
  -d '{"action": "refresh"}'
```

## 错误处理

系统实现了完善的错误处理机制：

| 错误代码 | HTTP状态 | 说明 | 处理建议 |
|---------|---------|------|---------|
| MISSING_API_KEY | 500 | 未提供API Key | 设置环境变量或请求头 |
| INVALID_API_KEY_FORMAT | 500 | API Key格式错误 | 检查格式是否为sk-xxxxx |
| UNAUTHORIZED | 401 | API Key无效 | 检查API Key是否正确 |
| FORBIDDEN | 403 | 无权限 | 检查API Key权限 |
| NETWORK_ERROR | 500 | 网络错误 | 检查网络连接 |
| API_ERROR | 500 | API返回错误 | 稍后重试 |

## 安全注意事项

1. **API Key保护**: API Key仅在后端使用，不会暴露到前端
2. **请求头传递**: 支持通过 `X-API-Key` 请求头传递API Key
3. **环境变量**: 推荐在生产环境使用环境变量配置API Key
4. **错误信息**: 错误响应不会暴露敏感信息

## 已知限制

1. **API可用性**: 阿里云百炼目前没有公开的额度查询API，实际调用可能返回空数据
2. **数据实时性**: 控制台显示的额度数据为分钟级更新
3. **地域差异**: 不同地域（北京/新加坡）的API Key和额度是独立的

## 后续优化建议

1. 监控阿里云百炼API更新，及时切换到真实API
2. 实现额度预警功能（当剩余额度低于阈值时通知）
3. 添加额度使用趋势分析
4. 支持多地域API Key管理
