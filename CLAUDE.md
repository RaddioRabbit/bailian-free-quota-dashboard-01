# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 14 dashboard for monitoring Alibaba Cloud Bailian (百炼) model quota information. It displays free tier usage, expiration dates, and remaining quotas for various LLMs including Qwen and DeepSeek models.

## Development Commands

All commands should be run from the `bailian-dashboard` directory:

```bash
cd /Users/mima0000/Desktop/WorkplaceAgent/LiweiAgent/UsageAgent/bailian-dashboard
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 3010 |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Architecture

### Data Flow Architecture

```
Client Component (dashboard-content.tsx)
    ↓ fetch()
API Route (/api/models/route.ts)
    ↓
Data Layer (lib/data/api.ts)
    ↓
Data Sources (priority order):
  1. Console Scraper (lib/data/console-scraper.ts) - Playwright-based real data
  2. API Scraper (lib/data/bailian-scraper.ts) - HTTP API attempts
  3. Mock Provider (lib/data/mock-provider.ts) - Fallback demo data
```

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/api/models/` | Model quota data endpoint |
| `app/api/auth/` | Session-based auth for console scraping |
| `components/dashboard/` | Dashboard-specific UI components |
| `components/ui/` | shadcn/ui base components |
| `lib/data/` | Data fetching and scraping logic |
| `lib/utils/` | Utility functions (formatting, etc.) |

### Data Sources

The system attempts to fetch real data in this priority order:

1. **Console Scraper** (`lib/data/console-scraper.ts`): Uses Playwright to scrape the Alibaba Cloud console with a saved browser session. Session stored in `.session.json`.
2. **API Scraper** (`lib/data/bailian-scraper.ts`): Attempts multiple HTTP endpoints to fetch quota data using API Key.
3. **Mock Provider** (`lib/data/mock-provider.ts`): Fallback static data for demo purposes.

### Caching

- In-memory caching in `lib/data/api.ts` with 5-minute TTL
- Cache key includes API key or session identifier
- Call `clearCache()` to force refresh

### Authentication

Two authentication methods are supported:

1. **Browser Session (Recommended)**: User clicks "Login" button → Playwright opens visible browser → User logs in manually → Session saved to `.session.json`
2. **API Key**: Set `DASHSCOPE_API_KEY` in `.env.local` (limited functionality - quota queries may not work)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models` | GET | Fetch model quota data |
| `/api/models` | POST | Actions: `verify` (check API key), `refresh` (clear cache) |
| `/api/auth` | GET | Check login status |
| `/api/auth` | POST | Actions: `login`, `logout`, `refresh` |

### Environment Variables

Copy `.env.example` to `.env.local` to configure:

```bash
# Optional: API Key for limited API access
DASHSCOPE_API_KEY=sk-your-key

# Optional: Cache TTL in milliseconds (default: 5 minutes)
CACHE_TTL=300000
```

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui (base-nova style)
- **Icons**: Lucide React
- **Charts**: Recharts
- **Browser Automation**: Playwright
- **Theme**: next-themes (light/dark/system)

### Important Files

| File | Purpose |
|------|---------|
| `components/dashboard/dashboard-content.tsx` | Main dashboard state management, filtering, sorting |
| `lib/data/types.ts` | Core TypeScript interfaces (ModelQuota, DashboardData) |
| `lib/data/api.ts` | Main data fetching entry point with caching |
| `lib/data/console-scraper.ts` | Playwright-based console scraping |
| `lib/data/bailian-scraper.ts` | HTTP API scraping with retry logic |
| `lib/utils/format.ts` | Number/date formatting utilities |
