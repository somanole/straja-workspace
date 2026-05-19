import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEvalCaseDraftFromTrace,
  createEvalCase,
  createEvalSuite,
  deleteEvalCase,
  duplicateBuiltinSuite,
  evaluateTraceAssertions,
  getEvalSuiteDetail,
  listEvalSuites,
  readCase,
  readOrchestrationTrace,
  seedEvalDefaults,
  updateEvalCase,
  type EvalStoreLike,
} from "../src/evals.js";

type StoredDoc = {
  id: number;
  hash: string;
  path: string;
  title: string;
  content: string;
  modified_at: string;
  active: boolean;
};

function createMockEvalStore(): EvalStoreLike & {
  docs: Map<string, StoredDoc>;
  writeJson: (collection: string, path: string, data: unknown, now?: string) => void;
} {
  let nextId = 1;
  const docs = new Map<string, StoredDoc>();
  const contentByHash = new Map<string, string>();

  const keyFor = (collection: string, path: string) => `${collection}:${path}`;

  const normalizePattern = (pattern: string) =>
    new RegExp(
      `^${pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")}$`,
    );

  const writeJson = (collection: string, path: string, data: unknown, now = new Date().toISOString()) => {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const hash = createHash("sha256").update(content).digest("hex");
    contentByHash.set(hash, content);
    const existing = docs.get(keyFor(collection, path));
    if (existing) {
      docs.set(keyFor(collection, path), {
        ...existing,
        hash,
        path,
        title: path,
        content,
        modified_at: now,
        active: true,
      });
    } else {
      docs.set(keyFor(collection, path), {
        id: nextId++,
        hash,
        path,
        title: path,
        content,
        modified_at: now,
        active: true,
      });
    }
  };

  return {
    docs,
    db: {
      prepare() {
        return {
          all: (collection: unknown, pattern: unknown) => {
            const regex = normalizePattern(typeof pattern === "string" ? pattern : "%");
            return Array.from(docs.entries())
              .filter(([, entry]) => entry.active)
              .filter(([key, entry]) => key.startsWith(`${String(collection)}:`) && regex.test(entry.path))
              .map(([, entry]) => ({
                path: entry.path,
                doc: entry.content,
                modified_at: entry.modified_at,
              }))
              .sort((a, b) => {
                const timeDiff = Date.parse(b.modified_at) - Date.parse(a.modified_at);
                return timeDiff !== 0 ? timeDiff : a.path.localeCompare(b.path);
              });
          },
          get: () => undefined,
        };
      },
    },
    findActiveDocument(collection: string, path: string) {
      const entry = docs.get(keyFor(collection, path));
      return entry && entry.active ? { id: entry.id, hash: entry.hash, title: entry.title } : null;
    },
    getDocumentWithContent(collection: string, path: string) {
      const entry = docs.get(keyFor(collection, path));
      return entry && entry.active
        ? { id: entry.id, hash: entry.hash, title: entry.title, content: entry.content }
        : null;
    },
    insertContent(hash: string, content: string) {
      contentByHash.set(hash, content);
    },
    insertDocument(collection: string, path: string, title: string, hash: string, _createdAt: string, modifiedAt: string) {
      docs.set(keyFor(collection, path), {
        id: nextId++,
        hash,
        path,
        title,
        content: contentByHash.get(hash) ?? "",
        modified_at: modifiedAt,
        active: true,
      });
    },
    updateDocument(documentId: number, title: string, hash: string, modifiedAt: string) {
      for (const [key, entry] of docs.entries()) {
        if (entry.id !== documentId) continue;
        docs.set(key, {
          ...entry,
          title,
          hash,
          content: contentByHash.get(hash) ?? "",
          modified_at: modifiedAt,
          active: true,
        });
      }
    },
    deactivateDocument(collection: string, path: string) {
      const entry = docs.get(keyFor(collection, path));
      if (!entry) return;
      docs.set(keyFor(collection, path), { ...entry, active: false });
    },
    writeJson,
  };
}

describe("evals core", () => {
  it("seeds built-in suites idempotently", () => {
    const store = createMockEvalStore();
    seedEvalDefaults(store);
    seedEvalDefaults(store);

    const suites = listEvalSuites(store);
    expect(suites.map((suite) => suite.id)).toEqual([
      "builtin.routing",
      "builtin.safety",
      "builtin.smoke",
      "builtin.tool_use",
    ].sort((a, b) => {
      const aBuiltin = true;
      const bBuiltin = true;
      if (aBuiltin !== bBuiltin) return aBuiltin ? -1 : 1;
      return a.localeCompare(b);
    }));
    expect(store.docs.size).toBeGreaterThanOrEqual(39);
    expect(getEvalSuiteDetail(store, "builtin.smoke")?.cases).toHaveLength(10);
  });

  it("creates, updates, deletes, and duplicates custom eval entities", () => {
    const store = createMockEvalStore();
    seedEvalDefaults(store);

    const suite = createEvalSuite(store, {
      name: "Customer Ops",
      description: "Custom validation suite",
    });

    const created = createEvalCase(store, {
      suite_id: suite.id,
      name: "hello world",
      description: "Simple chat",
      target_type: "agent",
      target_id: "default",
      mode: "dry_run",
      input_text: "Say hello",
      assertions: [{ type: "output_exists" }],
    });

    const updated = updateEvalCase(store, created.id, {
      name: "hello world updated",
      assertions: [{ type: "output_contains", value: ["hello"] }],
      enabled: false,
    });
    expect(updated.name).toBe("hello world updated");
    expect(updated.enabled).toBe(false);
    expect(readCase(store, created.id)?.assertions[0]?.type).toBe("output_contains");

    deleteEvalCase(store, created.id);
    expect(readCase(store, created.id)).toBeNull();
    expect(getEvalSuiteDetail(store, suite.id)?.cases).toHaveLength(0);

    const duplicated = duplicateBuiltinSuite(store, "builtin.smoke");
    expect(duplicated.builtin).toBe(false);
    expect(duplicated.cases).toHaveLength(10);
  });

  it("evaluates deterministic assertions across route, tools, output, and budgets", () => {
    const results = evaluateTraceAssertions(
      [
        { type: "route_equals", value: "default_specialist" },
        { type: "required_tools_used", value: ["vault_search"] },
        { type: "forbidden_tools_not_used", value: ["vault_memory_write"] },
        { type: "output_contains", value: ["hello"] },
        { type: "max_total_tokens", value: 50 },
        { type: "max_duration_ms", value: 1000 },
      ],
      {
        run: {
          traceId: "trace-1",
          finalRoute: "default_specialist",
          status: "completed",
        },
        steps: [
          {
            path: "steps/trace-1/001.json",
            stage: "tool:call",
            data: { toolName: "vault_search" },
          },
        ],
        prompts: [
          {
            path: "prompts/trace-1/reply-output.json",
            kind: "output",
            runId: "reply",
            assistantTexts: ["hello from the vault"],
            usage: { input: 10, output: 5, total: 15 },
          },
        ],
        execution: {
          finalPayloads: [{ text: "hello from the vault" }],
          toolCalls: [{ name: "vault_search", outcome: "success" }],
        },
        durationMs: 400,
        mode: "dry_run",
      },
    );

    expect(results.every((result) => result.status === "passed")).toBe(true);
  });

  it("builds an eval draft from a saved orchestration trace", () => {
    const store = createMockEvalStore();
    const baseTime = Date.parse("2026-05-17T12:00:00.000Z");
    store.writeJson("_orchestration", "runs/trace-abc.json", {
      traceId: "trace-abc",
      inboundText: "Search my workspace for onboarding docs.",
      finalRoute: "vault_specialist",
      assignedAgentId: "default",
      status: "completed",
      policyChecks: { prompt_injection: false },
      createdAt: new Date(baseTime).toISOString(),
      updatedAt: new Date(baseTime + 2500).toISOString(),
    });
    store.writeJson("_orchestration", "steps/trace-abc/001.json", {
      traceId: "trace-abc",
      timestamp: new Date(baseTime).toISOString(),
      stage: "tool:call",
      data: { toolName: "vault_search" },
    });
    store.writeJson("_orchestration", "steps/trace-abc/002.json", {
      traceId: "trace-abc",
      timestamp: new Date(baseTime + 2000).toISOString(),
      stage: "dispatch:end",
      data: {},
    });
    store.writeJson("_orchestration", "prompts/trace-abc/reply-output.json", {
      runId: "reply",
      timestamp: new Date(baseTime + 2000).toISOString(),
      assistantTexts: ["I found the onboarding docs."],
      usage: { input: 20, output: 10, total: 30 },
    });

    const draft = buildEvalCaseDraftFromTrace(store, "trace-abc");
    const trace = readOrchestrationTrace(store, "trace-abc");

    expect(trace.run?.traceId).toBe("trace-abc");
    expect(draft.case.input_text).toContain("onboarding docs");
    expect(draft.case.assertions.some((assertion) => assertion.type === "route_equals")).toBe(true);
    expect(draft.case.assertions.some((assertion) => assertion.type === "required_tools_used")).toBe(true);
    expect(draft.case.assertion_options.some((option) => option.key === "max_total_tokens" && option.checked)).toBe(true);
  });
});
