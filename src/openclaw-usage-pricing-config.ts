export type OpenClawUsagePricingCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type OpenClawUsagePricingModel = {
  provider: string;
  model: string;
  label: string;
  official: boolean;
  sourceUrl: string;
  cost: OpenClawUsagePricingCost;
};

const OPENAI_PRICING_URL = "https://openai.com/api/pricing/";
const OPENAI_RESPONSES_API = "openai-responses";
const OPENAI_CODEX_RESPONSES_API = "openai-codex-responses";

const OFFICIAL_USAGE_PRICING_MODELS: OpenClawUsagePricingModel[] = [
  {
    provider: "openai-codex",
    model: "gpt-5.4",
    label: "openai-codex/gpt-5.4",
    official: true,
    sourceUrl: OPENAI_PRICING_URL,
    cost: {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 0,
    },
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    label: "openai/gpt-5.4",
    official: true,
    sourceUrl: OPENAI_PRICING_URL,
    cost: {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 0,
    },
  },
];

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function ensureProviderContainer(config: Record<string, any>, provider: string): Record<string, any> {
  if (typeof config.models !== "object" || config.models === null) config.models = {};
  if (typeof config.models.providers !== "object" || config.models.providers === null || Array.isArray(config.models.providers)) {
    config.models.providers = {};
  }
  const providers = config.models.providers as Record<string, any>;
  if (typeof providers[provider] !== "object" || providers[provider] === null || Array.isArray(providers[provider])) {
    providers[provider] = {};
  }
  const providerEntry = providers[provider] as Record<string, any>;
  if (!Array.isArray(providerEntry.models)) {
    providerEntry.models = [];
  }
  return providerEntry;
}

function ensureOfficialProviderDefaults(provider: string, providerEntry: Record<string, any>): void {
  if (provider === "openai-codex") {
    if (typeof providerEntry.baseUrl !== "string" || !providerEntry.baseUrl.trim()) {
      providerEntry.baseUrl = "https://chatgpt.com/backend-api";
    }
    providerEntry.api = OPENAI_CODEX_RESPONSES_API;
    return;
  }
  if (provider === "openai") {
    if (typeof providerEntry.baseUrl !== "string" || !providerEntry.baseUrl.trim()) {
      providerEntry.baseUrl = "https://api.openai.com/v1";
    }
    if (typeof providerEntry.api !== "string" || !providerEntry.api.trim()) {
      providerEntry.api = OPENAI_RESPONSES_API;
    }
  }
}

function mergeCostWithDefaults(
  existing: Record<string, any> | undefined,
  defaults: OpenClawUsagePricingCost,
): OpenClawUsagePricingCost {
  const current = existing && typeof existing === "object" ? existing : {};
  const read = (key: keyof OpenClawUsagePricingCost): number => {
    const value = current[key];
    return typeof value === "number" && Number.isFinite(value) ? value : defaults[key];
  };
  return {
    input: read("input"),
    output: read("output"),
    cacheRead: read("cacheRead"),
    cacheWrite: read("cacheWrite"),
  };
}

export function getOfficialUsagePricingModels(): OpenClawUsagePricingModel[] {
  return OFFICIAL_USAGE_PRICING_MODELS.map((entry) => ({
    ...entry,
    cost: { ...entry.cost },
  }));
}

export function listConfiguredUsagePricingModels(
  config: Record<string, any>,
): OpenClawUsagePricingModel[] {
  const providers =
    config?.models?.providers &&
    typeof config.models.providers === "object" &&
    !Array.isArray(config.models.providers)
      ? (config.models.providers as Record<string, any>)
      : {};

  const rows: OpenClawUsagePricingModel[] = [];
  for (const [provider, providerEntry] of Object.entries(providers)) {
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    for (const modelEntry of models) {
      const model = typeof modelEntry?.id === "string" ? modelEntry.id.trim() : "";
      if (!model) continue;
      const official = OFFICIAL_USAGE_PRICING_MODELS.find(
        (entry) => entry.provider === provider && entry.model === model,
      );
      const currentCost =
        modelEntry?.cost && typeof modelEntry.cost === "object" ? modelEntry.cost as Record<string, any> : undefined;
      rows.push({
        provider,
        model,
        label: `${provider}/${model}`,
        official: Boolean(official),
        sourceUrl: official?.sourceUrl ?? OPENAI_PRICING_URL,
        cost: mergeCostWithDefaults(currentCost, official?.cost ?? {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      });
    }
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

export function readUsagePricingBenchmarkRef(
  config: Record<string, any>,
): { provider: string; model: string } | null {
  const benchmark =
    config?.meta?.usagePricingBenchmark &&
    typeof config.meta.usagePricingBenchmark === "object" &&
    !Array.isArray(config.meta.usagePricingBenchmark)
      ? (config.meta.usagePricingBenchmark as Record<string, any>)
      : null;
  const provider = typeof benchmark?.provider === "string" ? benchmark.provider.trim() : "";
  const model = typeof benchmark?.model === "string" ? benchmark.model.trim() : "";
  return provider && model ? { provider, model } : null;
}

export function applyOfficialUsagePricingDefaults(
  config: Record<string, any>,
  touchedAt: string,
): Record<string, any> {
  const next = cloneConfig<Record<string, any>>(config ?? {});
  for (const official of OFFICIAL_USAGE_PRICING_MODELS) {
    const providerEntry = ensureProviderContainer(next, official.provider);
    ensureOfficialProviderDefaults(official.provider, providerEntry);
    const models = providerEntry.models as Array<Record<string, any>>;
    const existing = models.find((entry) => entry?.id === official.model);
    if (existing) {
      existing.cost = mergeCostWithDefaults(existing.cost, official.cost);
      if (typeof existing.name !== "string" || !existing.name.trim()) {
        existing.name = official.model.toUpperCase().replace(/^GPT-/, "GPT-");
      }
      if (typeof existing.reasoning !== "boolean") {
        existing.reasoning = true;
      }
      if (!Array.isArray(existing.input) || existing.input.length === 0) {
        existing.input = ["text"];
      }
      if (typeof existing.contextWindow !== "number" || !Number.isFinite(existing.contextWindow)) {
        existing.contextWindow = 1_050_000;
      }
      if (typeof existing.maxTokens !== "number" || !Number.isFinite(existing.maxTokens)) {
        existing.maxTokens = 128_000;
      }
      continue;
    }
    models.push({
      id: official.model,
      name: official.model.toUpperCase().replace(/^GPT-/, "GPT-"),
      reasoning: true,
      input: ["text"],
      cost: { ...official.cost },
      contextWindow: 1_050_000,
      maxTokens: 128_000,
    });
  }
  if (typeof next.meta !== "object" || next.meta === null) next.meta = {};
  next.meta.lastTouchedAt = touchedAt;
  return next;
}

export function upsertUsagePricingModelCost(
  config: Record<string, any>,
  params: {
    provider: string;
    model: string;
    cost: OpenClawUsagePricingCost;
    touchedAt: string;
  },
): Record<string, any> {
  const next = cloneConfig<Record<string, any>>(config ?? {});
  const providerEntry = ensureProviderContainer(next, params.provider);
  ensureOfficialProviderDefaults(params.provider, providerEntry);
  const models = providerEntry.models as Array<Record<string, any>>;
  let entry = models.find((item) => item?.id === params.model);
  if (!entry) {
    const official = OFFICIAL_USAGE_PRICING_MODELS.find(
      (item) => item.provider === params.provider && item.model === params.model,
    );
    entry = {
      id: params.model,
      name: official?.model.toUpperCase().replace(/^GPT-/, "GPT-") ?? params.model,
      reasoning: true,
      input: ["text"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      cost: { ...params.cost },
    };
    models.push(entry);
  } else {
    entry.cost = { ...params.cost };
  }
  if (typeof next.meta !== "object" || next.meta === null) next.meta = {};
  next.meta.usagePricingBenchmark = {
    provider: params.provider,
    model: params.model,
  };
  next.meta.lastTouchedAt = params.touchedAt;
  return next;
}
