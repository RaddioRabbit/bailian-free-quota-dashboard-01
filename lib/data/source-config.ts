import fs from "node:fs";
import path from "node:path";

export interface BailianSourceConfig {
  sourceUrls: string[];
  updatedAt?: string;
}

export const SOURCE_CONFIG_PATH = path.join(process.cwd(), ".source-config.json");

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
  if (!fs.existsSync(SOURCE_CONFIG_PATH)) {
    return { sourceUrls: [] };
  }

  try {
    const raw = fs.readFileSync(SOURCE_CONFIG_PATH, "utf8");
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

  fs.writeFileSync(SOURCE_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  return config;
}

export function getSourceUrlsPreview(sourceUrls: string[], limit: number = 2): string[] {
  return sourceUrls.slice(0, limit);
}
