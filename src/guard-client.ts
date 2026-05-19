/**
 * Guard Client — HTTP client for communicating with Straja Guard (gateway).
 *
 * Provides:
 *   - Activation event ingestion (webhook receiver side)
 *   - Guard API calls for text egress checks (/v1/guard/request, /v1/guard/response)
 *   - Health/status checks (/healthz, /readyz)
 */

import type { Store } from "./store.js";
import { appendAuditEntry } from "./audit.js";

// ---------------------------------------------------------------------------
// Types — mirrors straja-gateway's activation.Event (Go → TS)
// ---------------------------------------------------------------------------

export interface GuardActionEntry {
  category: string;
  action: string;
  confidence?: number;
  sources?: string[];
  evidence?: string;
}

export interface GuardActivationEvent {
  version: string;
  timestamp: string;
  request_id: string;
  meta: {
    project_id: string;
    provider_id: string;
    provider: string;
    model: string;
    mode: string;
  };
  summary: {
    request_final: string;
    response_final: string;
    response_note?: string | null;
    blocked: boolean;
    categories?: string[] | null;
  };
  request: {
    decision: {
      final: string;
      reason_categories?: string[];
      actions?: GuardActionEntry[];
    };
    preview: {
      prompt?: string;
      tool?: { tool_name: string; args?: string };
    };
    hits?: GuardActionEntry[];
    scores?: Record<string, number>;
    strajaguard?: Record<string, unknown>;
    latency_ms: number;
  };
  response: {
    decision: {
      final: string;
      note?: string | null;
      reason_categories?: string[];
      actions?: GuardActionEntry[];
    };
    preview: {
      output?: string;
    };
    hits?: GuardActionEntry[];
    scores?: Record<string, number>;
    latency_ms: number;
  };
  intel: {
    status: string;
    bundle_version?: string;
    last_validated_at?: string;
    cache_present: boolean;
    strajaguard?: {
      status: string;
      bundle_version?: string;
      model?: string;
      specialists_config_source?: string;
    };
    thresholds?: Record<string, { warn?: number; block?: number }>;
  };
  timing_ms: {
    provider: number;
    total: number;
  };
}

export interface GuardCheckResult {
  decision: string; // "allow" | "block" | "redact"
  categories: string[];
  actions: GuardActionEntry[];
  scores: Record<string, number>;
}

export interface GuardHealthStatus {
  healthy: boolean;
  ready: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Activation Event Ingestion
// ---------------------------------------------------------------------------

/**
 * Ingest a Guard activation event into the vault's audit system.
 *
 * Maps the gateway's rich activation event to the vault's unified audit
 * entry format, preserving all guard-specific details.
 */
export async function ingestGuardActivation(
  store: Store,
  event: GuardActivationEvent,
): Promise<void> {
  const blocked = event.summary.blocked;
  const verdict = blocked ? "blocked" : "allowed";
  const categories = Array.isArray(event.summary.categories) ? event.summary.categories : [];

  // Build a human-readable action description
  const model = event.meta.model || "unknown";
  const provider = event.meta.provider || "unknown";
  let action = `${event.meta.mode === "stream" ? "streaming" : "non-streaming"} request to ${model}`;
  if (event.request.preview.tool) {
    action = `tool call: ${event.request.preview.tool.tool_name}`;
  }

  // Determine severity from what was detected
  let severity: "low" | "medium" | "high" = "low";
  if (blocked) {
    severity = "high";
  } else if (categories.length > 0) {
    severity = "medium";
  }

  await appendAuditEntry(store, "guard", {
    timestamp: event.timestamp,
    toolName: "straja_guard",
    action,
    verdict,
    reason: blocked
      ? `Blocked: ${categories.join(", ")}`
      : categories.length > 0
        ? `Detected: ${categories.join(", ")} (allowed)`
        : "Clean",
    severity,
    domain: null,
    url: null,
    // Guard-specific fields stored in details
    details: {
      request_id: event.request_id,
      provider,
      model,
      mode: event.meta.mode,
      project_id: event.meta.project_id,
      request_preview: event.request.preview?.prompt ?? null,
      response_preview: event.response.preview?.output ?? null,
      request_decision: event.request.decision.final,
      response_decision: event.response.decision.final,
      categories,
      request_scores: event.request.scores,
      response_scores: event.response.scores,
      request_hits: event.request.hits,
      response_hits: event.response.hits,
      strajaguard: event.request.strajaguard,
      intel_status: event.intel.status,
      bundle_version: event.intel.bundle_version,
      timing_ms: event.timing_ms,
      request_latency_ms: event.request.latency_ms,
      response_latency_ms: event.response.latency_ms,
    },
  });
}

// ---------------------------------------------------------------------------
// Guard API Client
// ---------------------------------------------------------------------------

/**
 * Call Guard's /v1/guard/request endpoint to check text before egress.
 */
export async function checkTextEgress(
  guardUrl: string,
  guardApiKey: string,
  text: string,
  metadata?: Record<string, unknown>,
): Promise<GuardCheckResult> {
  const resp = await fetch(`${guardUrl}/v1/guard/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(guardApiKey ? { Authorization: `Bearer ${guardApiKey}` } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: text }],
      ...(metadata ? { metadata } : {}),
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    throw new Error(`Guard API returned ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  return {
    decision: (data.decision as string) ?? "allow",
    categories: (data.categories as string[]) ?? [],
    actions: (data.actions as GuardActionEntry[]) ?? [],
    scores: (data.scores as Record<string, number>) ?? {},
  };
}

/**
 * Check Guard health via /healthz and /readyz.
 */
export async function checkGuardHealth(guardUrl: string): Promise<GuardHealthStatus> {
  try {
    const [healthResp, readyResp] = await Promise.all([
      fetch(`${guardUrl}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${guardUrl}/readyz`, { signal: AbortSignal.timeout(3000) }),
    ]);
    return {
      healthy: healthResp.ok,
      ready: readyResp.ok,
    };
  } catch (err) {
    return {
      healthy: false,
      ready: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
