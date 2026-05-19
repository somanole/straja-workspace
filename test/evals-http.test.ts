import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/agent-gateway-client.js", async () => {
  const { createStore } = await import("../src/store.js");

  function upsertJsonDoc(store: ReturnType<typeof createStore>, collection: string, path: string, data: unknown, now: string) {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const hash = createHash("sha256").update(content).digest("hex");
    store.insertContent(hash, content, now);
    const existing = store.findActiveDocument(collection, path);
    if (existing) {
      store.updateDocument(existing.id, path, hash, now);
    } else {
      store.insertDocument(collection, path, path, hash, now, now);
    }
  }

  return {
    agentGatewayRpc: vi.fn(async (_gatewayUrl: string, _token: string, method: string, params: Record<string, unknown>) => {
      if (method === "config.get") {
        return {};
      }
      if (method !== "agents.flow.test") {
        return {};
      }

      const store = createStore(process.env.INDEX_PATH);
      const now = new Date().toISOString();
      const sessionKey = `eval-session-${randomUUID().slice(0, 8)}`;
      const traceId = `trace-${randomUUID().slice(0, 8)}`;
      const message = typeof params.message === "string" ? params.message : "";
      const normalized = message.toLowerCase();
      const usesVault = normalized.includes("vault") || normalized.includes("workspace");
      const route = usesVault ? "vault_specialist" : "default_specialist";
      const output = normalized.includes("healthy")
        ? "The workspace is healthy."
        : usesVault
          ? "I searched the vault and found the onboarding notes."
          : "Hello from the eval runner.";
      const toolCalls = usesVault
        ? [{ name: "vault_search", outcome: "success" }]
        : [];

      upsertJsonDoc(store, "_orchestration", `runs/${traceId}.json`, {
        traceId,
        sessionKey,
        status: "completed",
        finalRoute: route,
        assignedAgentId: typeof params.agentId === "string" ? params.agentId : "default",
        inboundText: message,
        createdAt: now,
        updatedAt: now,
      }, now);
      upsertJsonDoc(store, "_orchestration", `steps/${traceId}/001.json`, {
        traceId,
        timestamp: now,
        stage: "route:evaluated",
        data: { finalRoute: route },
      }, now);
      if (usesVault) {
        upsertJsonDoc(store, "_orchestration", `steps/${traceId}/002.json`, {
          traceId,
          timestamp: now,
          stage: "tool:call",
          data: { toolName: "vault_search" },
        }, now);
      }
      upsertJsonDoc(store, "_orchestration", `prompts/${traceId}/reply-output.json`, {
        runId: "reply",
        timestamp: now,
        assistantTexts: [output],
        usage: { input: 18, output: 12, total: 30 },
      }, now);

      return {
        ok: true,
        mode: params.mode,
        input: {
          sessionKey,
          channel: "eval",
          message,
        },
        finalPayloads: [{ text: output }],
        blockPayloads: [],
        partialPayloads: [],
        toolStarts: [],
        toolResults: [],
        toolCalls,
        vaultMutations: [],
        messageActions: [],
      };
    }),
  };
});

import { startMcpHttpServer, type HttpServerHandle } from "../src/mcp.js";
import type { CollectionConfig } from "../src/collections.js";

describe("evals HTTP", () => {
  let handle: HttpServerHandle | null = null;
  let baseUrl = "";
  let dbPath = "";
  let configDir = "";
  let logsDir = "";
  let startupError: NodeJS.ErrnoException | null = null;

  const adminToken = "vault-admin-test-token";
  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;
  const origLogsDir = process.env.STRAJA_WORKSPACE_APP_LOGS_DIR;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `vault-evals-http-${Date.now()}.sqlite`);
    configDir = await mkdtemp(join(tmpdir(), "vault-evals-config-"));
    logsDir = await mkdtemp(join(tmpdir(), "vault-evals-logs-"));

    const config: CollectionConfig = { collections: {} };
    await writeFile(join(configDir, "index.yml"), YAML.stringify(config));

    process.env.INDEX_PATH = dbPath;
    process.env.VAULT_CONFIG_DIR = configDir;
    process.env.VAULT_HTTP_ADMIN_TOKEN = adminToken;
    process.env.STRAJA_WORKSPACE_APP_LOGS_DIR = logsDir;

    try {
      handle = await startMcpHttpServer(0, { quiet: true });
      baseUrl = `http://localhost:${handle.port}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "EPERM" && err?.syscall === "listen") {
        startupError = err;
        return;
      }
      throw error;
    }
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }

    if (origIndexPath !== undefined) process.env.INDEX_PATH = origIndexPath;
    else delete process.env.INDEX_PATH;
    if (origConfigDir !== undefined) process.env.VAULT_CONFIG_DIR = origConfigDir;
    else delete process.env.VAULT_CONFIG_DIR;
    if (origAdminToken !== undefined) process.env.VAULT_HTTP_ADMIN_TOKEN = origAdminToken;
    else delete process.env.VAULT_HTTP_ADMIN_TOKEN;
    if (origLogsDir !== undefined) process.env.STRAJA_WORKSPACE_APP_LOGS_DIR = origLogsDir;
    else delete process.env.STRAJA_WORKSPACE_APP_LOGS_DIR;

    try {
      await unlink(dbPath);
    } catch {
      // ignore
    }

    try {
      const files = await readdir(configDir);
      for (const file of files) {
        await rm(join(configDir, file), { recursive: true, force: true });
      }
      await rm(configDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    try {
      await rm(logsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function authedFetch(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  async function configureDefaultAgent() {
    const response = await authedFetch("/connections/agents/config", {
      method: "POST",
      body: JSON.stringify({
        id: "default",
        name: "Default",
        type: "openclaw",
        gatewayUrl: "http://localhost:18790",
        token: "hooks-token",
        hooksPath: "/hooks/agent",
        enabled: true,
        notifications: { gmail: true, gcalendar: true },
      }),
    });
    expect(response.status).toBe(200);
  }

  test("creates suites and cases, runs a suite, and saves an eval from trace", async () => {
    if (startupError) {
      console.warn(`Skipping evals HTTP test in restricted environment: ${startupError.message}`);
      return;
    }

    await configureDefaultAgent();

    const createSuiteResponse = await authedFetch("/evals/suites", {
      method: "POST",
      body: JSON.stringify({
        name: "HTTP Eval Suite",
        description: "Exercising suite execution through the HTTP API.",
      }),
    });
    expect(createSuiteResponse.status).toBe(201);
    const createSuiteBody = await createSuiteResponse.json() as { suite: { id: string } };
    const suiteId = createSuiteBody.suite.id;

    const createCaseBodies = [
      {
        suite_id: suiteId,
        name: "basic reply",
        description: "Should produce output and stay inside the token budget.",
        target_type: "agent",
        target_id: "default",
        mode: "dry_run",
        input_text: "Reply with a short healthy status.",
        assertions: [
          { type: "output_exists" },
          { type: "route_equals", value: "default_specialist" },
          { type: "max_total_tokens", value: 40 },
          { type: "max_duration_ms", value: 30_000 },
        ],
      },
      {
        suite_id: suiteId,
        name: "vault lookup",
        description: "Should use vault search.",
        target_type: "agent",
        target_id: "default",
        mode: "dry_run",
        input_text: "Search my workspace vault for onboarding docs.",
        assertions: [
          { type: "required_tools_used", value: ["vault_search"] },
          { type: "output_contains", value: ["vault"] },
        ],
      },
      {
        suite_id: suiteId,
        name: "forbidden tool fail",
        description: "Should fail when a forbidden tool is used.",
        target_type: "agent",
        target_id: "default",
        mode: "dry_run",
        input_text: "Search my workspace vault for onboarding docs.",
        assertions: [
          { type: "forbidden_tools_not_used", value: ["vault_search"] },
        ],
      },
    ];

    for (const body of createCaseBodies) {
      const response = await authedFetch("/evals/cases", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
    }

    const runResponse = await authedFetch(`/evals/suites/${encodeURIComponent(suiteId)}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(runResponse.status).toBe(200);
    const runBody = await runResponse.json() as {
      run: { id: string; passed: number; failed: number };
      results: Array<{ trace_id?: string; failure_reasons: string[] }>;
    };
    expect(runBody.run.passed).toBe(2);
    expect(runBody.run.failed).toBe(1);
    expect(runBody.results).toHaveLength(3);
    expect(runBody.results.every((result) => typeof result.trace_id === "string" && result.trace_id.length > 0)).toBe(true);
    expect(runBody.results.some((result) => result.failure_reasons[0]?.includes("Forbidden tool vault_search was called."))).toBe(true);

    const resultsResponse = await authedFetch(`/evals/runs/${encodeURIComponent(runBody.run.id)}/results`);
    expect(resultsResponse.status).toBe(200);
    const resultsBody = await resultsResponse.json() as {
      results: Array<{ trace_id?: string }>;
    };
    const traceId = resultsBody.results[0]?.trace_id;
    expect(traceId).toBeTruthy();

    const draftResponse = await authedFetch("/evals/cases/from-trace", {
      method: "POST",
      body: JSON.stringify({ trace_id: traceId }),
    });
    expect(draftResponse.status).toBe(200);
    const draftBody = await draftResponse.json() as {
      draft: { case: { assertion_options: Array<{ key: string; checked: boolean }> } };
    };
    expect(draftBody.draft.case.assertion_options.some((option) => option.key === "route_equals")).toBe(true);

    const saveFromTraceResponse = await authedFetch("/evals/cases/from-trace", {
      method: "POST",
      body: JSON.stringify({
        trace_id: traceId,
        suite_id: suiteId,
        name: "trace-derived case",
        assertion_keys: draftBody.draft.case.assertion_options
          .filter((option) => option.checked)
          .map((option) => option.key),
      }),
    });
    expect(saveFromTraceResponse.status).toBe(201);
    const saveFromTraceBody = await saveFromTraceResponse.json() as { case: { id: string; suite_id: string } };
    expect(saveFromTraceBody.case.suite_id).toBe(suiteId);

    const suiteDetailResponse = await authedFetch(`/evals/suites/${encodeURIComponent(suiteId)}`);
    expect(suiteDetailResponse.status).toBe(200);
    const suiteDetailBody = await suiteDetailResponse.json() as { suite: { cases: Array<{ id: string }> } };
    expect(suiteDetailBody.suite.cases.some((item) => item.id === saveFromTraceBody.case.id)).toBe(true);
  });
});
