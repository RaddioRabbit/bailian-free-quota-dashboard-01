import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidBailianSourceUrl,
  normalizeSourceUrlsInput,
} from "../lib/data/source-config.ts";
import {
  normalizeCapabilityTags,
  parseCapabilitiesFromSourceUrl,
} from "../lib/data/capabilities.ts";

test("normalizeSourceUrlsInput trims, dedupes, and preserves Bailian model market URLs", () => {
  const sourceUrls = normalizeSourceUrlsInput([
    "  https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen&capabilities=TG%2CReasoning  ",
    "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen&capabilities=TG%2CReasoning",
    "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=deepseek&capabilities=VU",
  ]);

  assert.deepEqual(sourceUrls, [
    "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen&capabilities=TG%2CReasoning",
    "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=deepseek&capabilities=VU",
  ]);
});

test("normalizeSourceUrlsInput rejects non-Bailian URLs", () => {
  assert.throws(
    () => normalizeSourceUrlsInput("https://example.com/model-market/all"),
    /仅支持阿里云百炼模型广场链接/
  );
});

test("isValidBailianSourceUrl only accepts Bailian model market pages", () => {
  assert.equal(
    isValidBailianSourceUrl(
      "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen&capabilities=TG"
    ),
    true
  );
  assert.equal(
    isValidBailianSourceUrl("https://bailian.console.aliyun.com/cn-beijing#/application"),
    false
  );
});

test("parseCapabilitiesFromSourceUrl maps capability codes to Chinese labels", () => {
  const tags = parseCapabilitiesFromSourceUrl(
    "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen&capabilities=Multimodal-Omni%2CTG%2CReasoning%2CVU%2CIG"
  );

  assert.deepEqual(tags, ["全模态", "文本生成", "深度思考", "视觉理解", "图像生成"]);
});

test("normalizeCapabilityTags dedupes mixed codes, objects, and labels", () => {
  const tags = normalizeCapabilityTags([
    "TG",
    "文本生成",
    { name: "Reasoning" },
    { label: "视觉理解" },
    "unknown",
  ]);

  assert.deepEqual(tags, ["文本生成", "深度思考", "视觉理解"]);
});
