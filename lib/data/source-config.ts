import fs from "node:fs";
import path from "node:path";

export interface BailianSourceConfig {
  sourceUrls: string[];
  updatedAt?: string;
}

// 容器与宿主机 watcher 共用同一份配置：放在 DATA_DIR（默认 ./data，docker-compose 中 volume mount）
function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getSourceConfigPath(): string {
  return path.join(getDataDir(), ".source-config.json");
}

// 兼容老路径（修复前写在 cwd），仅在新路径缺失时一次性迁移
function getLegacySourceConfigPath(): string {
  return path.join(process.cwd(), ".source-config.json");
}

// 保留导出以避免外部引用断裂；优先使用 getSourceConfigPath()
export const SOURCE_CONFIG_PATH = getSourceConfigPath();

export const SOURCE_URL_EXAMPLES = [
  "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen%2Cmini-max%2Cmoonshot-ai%2Czhipu-ai%2Cdeepseek&capabilities=Multimodal-Omni%2CTG%2CReasoning%2CVU%2CIG",
  "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen%2Cmini-max%2Cmoonshot-ai%2Czhipu-ai%2Cdeepseek&capabilities=TG%2CReasoning%2CVU%2CIG",
] as const;

function toSourceUrlList(input: string | string[]): string[] {
  const rawValues = Array.isArray(input) ? input : input.split(/\r?\n/);
  return rawValues.map((value) => value.trim()).filter(Boolean);
}

export function isValidBailianSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const route = `${url.pathname}${url.hash}`;
    return (
      url.hostname === "bailian.console.aliyun.com" &&
      route.includes("/model-market/")
    );
  } catch {
    return false;
  }
}

export function normalizeSourceUrlsInput(input: string | string[]): string[] {
  const uniqueUrls = Array.from(new Set(toSourceUrlList(input)));
  const invalidUrls = uniqueUrls.filter((value) => !isValidBailianSourceUrl(value));

  if (invalidUrls.length > 0) {
    throw new Error(`仅支持阿里云百炼模型广场链接: ${invalidUrls.join("、")}`);
  }

  return uniqueUrls;
}

export function loadSourceConfig(): BailianSourceConfig {
  const target = getSourceConfigPath();

  // 一次性迁移：新路径不存在但老路径有，则把老路径搬过来（搬完即旧路径不再被读）
  if (!fs.existsSync(target)) {
    const legacy = getLegacySourceConfigPath();
    if (legacy !== target && fs.existsSync(legacy)) {
      try {
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(legacy, target);
      } catch {
        // 迁移失败不致命，下面继续按"无配置"处理
      }
    }
  }

  if (!fs.existsSync(target)) {
    return { sourceUrls: [] };
  }

  try {
    const raw = fs.readFileSync(target, "utf8");
    const parsed = JSON.parse(raw) as Partial<BailianSourceConfig>;
    return {
      sourceUrls: normalizeSourceUrlsInput(parsed.sourceUrls || []),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { sourceUrls: [] };
  }
}

export function saveSourceConfig(input: string | string[]): BailianSourceConfig {
  const config: BailianSourceConfig = {
    sourceUrls: normalizeSourceUrlsInput(input),
    updatedAt: new Date().toISOString(),
  };

  const target = getSourceConfigPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(config, null, 2), "utf8");
  return config;
}

export function getSourceUrlsPreview(sourceUrls: string[], limit: number = 2): string[] {
  return sourceUrls.slice(0, limit);
}
