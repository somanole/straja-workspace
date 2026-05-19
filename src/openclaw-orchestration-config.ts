export function applyOpenClawOptimizationSetting(
  config: Record<string, any>,
  enabled: boolean,
  touchedAt: string,
): Record<string, any> {
  const next = JSON.parse(JSON.stringify(config ?? {})) as Record<string, any>;
  if (typeof next.agents !== "object" || next.agents === null) next.agents = {};
  if (typeof next.agents.defaults !== "object" || next.agents.defaults === null) next.agents.defaults = {};
  next.agents.defaults.orchestration = {
    ...(typeof next.agents.defaults.orchestration === "object" && next.agents.defaults.orchestration !== null
      ? next.agents.defaults.orchestration
      : {}),
    enabled,
    router: {
      ...(typeof next.agents.defaults.orchestration?.router === "object" && next.agents.defaults.orchestration.router !== null
        ? next.agents.defaults.orchestration.router
        : {}),
      enabled,
      model: "ollama/gemma4:e4b",
    },
    localFastPath: {
      ...(typeof next.agents.defaults.orchestration?.localFastPath === "object" &&
      next.agents.defaults.orchestration.localFastPath !== null
        ? next.agents.defaults.orchestration.localFastPath
        : {}),
      enabled,
      model: "ollama/gemma4:e4b",
      requireFlowContext: false,
    },
  };
  if (typeof next.meta !== "object" || next.meta === null) next.meta = {};
  next.meta.lastTouchedAt = touchedAt;
  return next;
}
