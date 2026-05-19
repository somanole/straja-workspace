import { describe, expect, test } from "vitest";

import { applyOpenClawOptimizationSetting } from "../src/openclaw-orchestration-config.js";

describe("applyOpenClawOptimizationSetting", () => {
  test("disables optimization persistently while preserving unrelated orchestration fields", () => {
    const config = {
      agents: {
        defaults: {
          orchestration: {
            enabled: true,
            router: {
              enabled: true,
              model: "ollama/gemma4:e4b",
              maxInputChars: 9000,
            },
            localFastPath: {
              enabled: true,
              model: "ollama/gemma4:e4b",
              requireFlowContext: true,
              maxInputChars: 1200,
            },
          },
        },
      },
      meta: {
        lastTouchedAt: "old",
      },
    };

    const next = applyOpenClawOptimizationSetting(config, false, "2026-04-16T12:00:00.000Z");

    expect(next.agents.defaults.orchestration.enabled).toBe(false);
    expect(next.agents.defaults.orchestration.router.enabled).toBe(false);
    expect(next.agents.defaults.orchestration.router.model).toBe("ollama/gemma4:e4b");
    expect(next.agents.defaults.orchestration.router.maxInputChars).toBe(9000);
    expect(next.agents.defaults.orchestration.localFastPath.enabled).toBe(false);
    expect(next.agents.defaults.orchestration.localFastPath.model).toBe("ollama/gemma4:e4b");
    expect(next.agents.defaults.orchestration.localFastPath.requireFlowContext).toBe(false);
    expect(next.agents.defaults.orchestration.localFastPath.maxInputChars).toBe(1200);
    expect(next.meta.lastTouchedAt).toBe("2026-04-16T12:00:00.000Z");
  });

  test("creates orchestration structure when missing", () => {
    const next = applyOpenClawOptimizationSetting({}, true, "2026-04-16T12:00:00.000Z");

    expect(next.agents.defaults.orchestration.enabled).toBe(true);
    expect(next.agents.defaults.orchestration.router).toEqual({
      enabled: true,
      model: "ollama/gemma4:e4b",
    });
    expect(next.agents.defaults.orchestration.localFastPath).toEqual({
      enabled: true,
      model: "ollama/gemma4:e4b",
      requireFlowContext: false,
    });
    expect(next.meta.lastTouchedAt).toBe("2026-04-16T12:00:00.000Z");
  });
});
