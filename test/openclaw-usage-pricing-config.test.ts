import { describe, expect, it } from "vitest";
import {
  applyOfficialUsagePricingDefaults,
  getOfficialUsagePricingModels,
  upsertUsagePricingModelCost,
} from "../src/openclaw-usage-pricing-config.js";

describe("openclaw usage pricing config", () => {
  it("seeds official GPT-5.4 pricing defaults without an existing models section", () => {
    const next = applyOfficialUsagePricingDefaults({}, "2026-04-16T18:00:00.000Z");
    expect(next.models.providers["openai-codex"].models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gpt-5.4",
          cost: expect.objectContaining({
            input: 2.5,
            output: 15,
            cacheRead: 0.25,
            cacheWrite: 0,
          }),
        }),
      ]),
    );
    expect(next.models.providers["openai-codex"].api).toBe("openai-codex-responses");
    expect(next.models.providers["openai"].api).toBe("openai-responses");
  });

  it("preserves user-edited pricing while filling missing cache fields", () => {
    const next = applyOfficialUsagePricingDefaults(
      {
        models: {
          providers: {
            "openai-codex": {
              models: [
                {
                  id: "gpt-5.4",
                  cost: {
                    input: 3,
                    output: 16,
                  },
                },
              ],
            },
          },
        },
      },
      "2026-04-16T18:00:00.000Z",
    );
    expect(next.models.providers["openai-codex"].models[0].cost).toEqual({
      input: 3,
      output: 16,
      cacheRead: 0.25,
      cacheWrite: 0,
    });
  });

  it("updates a pricing entry explicitly", () => {
    const current = applyOfficialUsagePricingDefaults({}, "2026-04-16T18:00:00.000Z");
    const next = upsertUsagePricingModelCost(current, {
      provider: "openai-codex",
      model: "gpt-5.4",
      cost: {
        input: 1.1,
        output: 2.2,
        cacheRead: 0.3,
        cacheWrite: 0.4,
      },
      touchedAt: "2026-04-16T18:01:00.000Z",
    });
    expect(next.models.providers["openai-codex"].models.find((entry: { id?: string }) => entry.id === "gpt-5.4")?.cost).toEqual({
      input: 1.1,
      output: 2.2,
      cacheRead: 0.3,
      cacheWrite: 0.4,
    });
    expect(
      next.models.providers["openai-codex"].models.find((entry: { id?: string }) => entry.id === "gpt-5.4"),
    ).not.toHaveProperty("api");
    expect(next.models.providers["openai-codex"].api).toBe("openai-codex-responses");
  });

  it("backfills provider api for existing official providers missing it", () => {
    const next = applyOfficialUsagePricingDefaults(
      {
        models: {
          providers: {
            "openai-codex": {
              baseUrl: "https://chatgpt.com/backend-api",
              models: [{ id: "gpt-5.4", name: "GPT-5.4" }],
            },
          },
        },
      },
      "2026-04-16T18:00:00.000Z",
    );
    expect(next.models.providers["openai-codex"].api).toBe("openai-codex-responses");
  });

  it("exposes the official pricing catalog", () => {
    expect(getOfficialUsagePricingModels()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "openai-codex",
          model: "gpt-5.4",
          sourceUrl: "https://openai.com/api/pricing/",
        }),
      ]),
    );
  });
});
