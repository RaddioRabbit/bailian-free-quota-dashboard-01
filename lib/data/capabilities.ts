const CAPABILITY_LABELS: Record<string, string> = {
  tg: "文本生成",
  textgeneration: "文本生成",
  text_generation: "文本生成",
  "文本生成": "文本生成",
  reasoning: "深度思考",
  thinking: "深度思考",
  "深度思考": "深度思考",
  vu: "视觉理解",
  visualunderstanding: "视觉理解",
  visionunderstanding: "视觉理解",
  "视觉理解": "视觉理解",
  ig: "图像生成",
  imagegeneration: "图像生成",
  "图像生成": "图像生成",
  "multimodal-omni": "全模态",
  multimodalomni: "全模态",
  omni: "全模态",
  "全模态": "全模态",
};

function normalizeCapabilityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
}

function mapCapabilityLabel(value: string): string | null {
  const normalized = normalizeCapabilityKey(value);
  return CAPABILITY_LABELS[normalized] || CAPABILITY_LABELS[normalized.replace(/-/g, "")] || null;
}

function extractCapabilityStrings(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return value
      .split(/[，,|/]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractCapabilityStrings(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      record.label,
      record.name,
      record.title,
      record.text,
      record.value,
      record.capability,
      record.capabilityName,
      record.tag,
    ].flatMap((item) => extractCapabilityStrings(item));
  }

  return [];
}

export function normalizeCapabilityTags(value: unknown): string[] {
  const tags = new Set<string>();

  for (const candidate of extractCapabilityStrings(value)) {
    const label = mapCapabilityLabel(candidate);
    if (label) {
      tags.add(label);
    }
  }

  return Array.from(tags);
}

export function mergeCapabilityTags(...groups: Array<unknown>): string[] {
  const merged = new Set<string>();

  for (const group of groups) {
    for (const label of normalizeCapabilityTags(group)) {
      merged.add(label);
    }
  }

  return Array.from(merged);
}

export function parseCapabilitiesFromSourceUrl(sourceUrl: string): string[] {
  try {
    const url = new URL(sourceUrl);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashQuery = hash.includes("?") ? hash.split("?")[1] : "";
    const params = new URLSearchParams(hashQuery);
    const rawCapabilities = params.get("capabilities");

    if (!rawCapabilities) {
      return [];
    }

    return normalizeCapabilityTags(rawCapabilities.split(","));
  } catch {
    return [];
  }
}
