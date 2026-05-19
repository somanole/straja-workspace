import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createStore, type Store } from "../src/store";
import {
  parseDuckDuckGoHtml,
  WebSearchController,
  type WebSearchAuditEntry,
} from "../src/web-search";

function todayAuditPath(): string {
  return `web-search-${new Date().toISOString().slice(0, 10)}.jsonl`;
}

function readAudit(store: Store): WebSearchAuditEntry[] {
  const doc = store.getDocumentWithContent("_audit", todayAuditPath());
  if (!doc?.content) return [];
  return doc.content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WebSearchAuditEntry);
}

const SAMPLE_HTML = `
<!doctype html>
<html>
  <body>
    <div class="results">
      <div class="result results_links results_links_deep web-result">
        <h2 class="result__title">
          <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falpha%3Fa%3D1%26b%3D2">
            Alpha &amp; Beta
          </a>
        </h2>
        <a class="result__snippet" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falpha%3Fa%3D1%26b%3D2">
          Concise <b>summary</b> for the first result.
        </a>
      </div>
      <div class="result results_links results_links_deep web-result">
        <h2 class="result__title">
          <a class="result__a" href="https://second.example/path">
            Second Result
          </a>
        </h2>
        <div class="result__snippet">
          Another result snippet.
        </div>
      </div>
    </div>
  </body>
</html>
`;

describe("web-search", () => {
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/vault-web-search-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
    store = createStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try { require("fs").unlinkSync(dbPath); } catch {}
  });

  test("parseDuckDuckGoHtml extracts title, url, snippet, and domain", () => {
    const results = parseDuckDuckGoHtml(SAMPLE_HTML, 10);

    expect(results).toEqual([
      {
        title: "Alpha & Beta",
        url: "https://example.com/alpha?a=1&b=2",
        snippet: "Concise summary for the first result.",
        domain: "example.com",
      },
      {
        title: "Second Result",
        url: "https://second.example/path",
        snippet: "Another result snippet.",
        domain: "second.example",
      },
    ]);
  });

  test("searchDuckDuckGo returns results and writes an allowed audit entry", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
    const controller = new WebSearchController(store, fetchMock as typeof fetch);

    const result = await controller.searchDuckDuckGo("  alpha   beta  ", 1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.query).toBe("alpha beta");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("Alpha & Beta");

    const audits = readAudit(store);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.verdict).toBe("allowed");
    expect(audits[0]?.provider).toBe("duckduckgo");
    expect(audits[0]?.query).toBe("alpha beta");
    expect(audits[0]?.resultCount).toBe(1);
  });

  test("searchDuckDuckGo blocks empty queries and audits the validation failure", async () => {
    const fetchMock = vi.fn();
    const controller = new WebSearchController(store, fetchMock as typeof fetch);

    await expect(controller.searchDuckDuckGo("   ")).rejects.toThrow(/required/i);
    expect(fetchMock).not.toHaveBeenCalled();

    const audits = readAudit(store);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.verdict).toBe("blocked");
    expect(audits[0]?.reason).toMatch(/required/i);
  });
});
