import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createStore, hashContent, type Store } from "../src/store";
import { BrowserSecurityController, type BrowserAuditEntry } from "../src/browser-security";
import { normalizeBrowserPolicy, resolveBrowserUrlDecision, type BrowserPolicy } from "../src/browser-policy";
import { encodeBrowserUploadBlobEnvelope } from "../src/browser-upload-staging";

function todayAuditPath(): string {
  return `browser-${new Date().toISOString().slice(0, 10)}.jsonl`;
}

async function seedDoc(store: Store, collection: string, path: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  const hash = await hashContent(content);
  store.insertContent(hash, content, now);
  const existing = store.findActiveDocument(collection, path);
  if (existing) {
    store.updateDocument(existing.id, path, hash, now);
  } else {
    store.insertDocument(collection, path, path, hash, now, now);
  }
}

function readAudit(store: Store): BrowserAuditEntry[] {
  const doc = store.getDocumentWithContent("_audit", todayAuditPath());
  if (!doc?.content) return [];
  return doc.content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BrowserAuditEntry);
}

function defaultPolicy(): BrowserPolicy {
  return {
    allowAllDomains: false,
    allowedDomains: [{ domain: "example.com" }],
    blockCrossDomainRedirects: true,
    uploadsEnabled: false,
    allowedUploadCollections: ["_uploads"],
    egressRules: [{ domain: "example.com", allowPost: false, allowUpload: false }],
    uploadConstraints: { maxFileSizeBytes: 1024 * 1024 },
    largePasteThresholdBytes: 32,
  };
}

describe("BrowserSecurityController", () => {
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/vault-browser-security-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
    store = createStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try { require("fs").unlinkSync(dbPath); } catch {}
  });

  test("blocks hidden browser tools and writes audit at tool boundary", async () => {
    const rawCall = vi.fn(async () => ({ content: [] }));
    const controller = new BrowserSecurityController(store, rawCall);

    await expect(controller.callExposedTool("browser_evaluate", {})).rejects.toThrow(/allowlisted/i);
    expect(rawCall).not.toHaveBeenCalled();

    const audits = readAudit(store);
    expect(audits.length).toBe(1);
    expect(audits[0]?.verdict).toBe("blocked");
    expect(audits[0]?.action).toBe("tool_call");
    expect(audits[0]?.severity).toBe("high");
  });

  test("uses structural submit probe to avoid heuristic false positive on non-submit button click", async () => {
    const rawCall = vi.fn(async (name: string) => {
      if (name === "browser_tab_list") {
        return { content: [{ type: "text", text: "0: https://example.com/app" }] };
      }
      if (name === "browser_evaluate") {
        return { content: [{ type: "text", text: "{\"isSubmitElement\":false,\"wouldSubmit\":false}" }] };
      }
      if (name === "browser_click") {
        return { content: [{ type: "text", text: "clicked" }] };
      }
      return { content: [] };
    });
    const controller = new BrowserSecurityController(store, rawCall);
    await controller.putPolicy(defaultPolicy());

    const result = await controller.callExposedTool("browser_click", { element: "Save button" });
    expect(result.content[0]?.text).toContain("clicked");
    expect(rawCall).toHaveBeenCalledWith("browser_click", { element: "Save button" });

    const audits = readAudit(store);
    expect(audits.some((a) => a.verdict === "allowed" && a.toolName === "browser_click")).toBe(true);
  });

  test("blocks submit when structural submit probe returns wouldSubmit=true", async () => {
    const rawCall = vi.fn(async (name: string) => {
      if (name === "browser_tab_list") {
        return { content: [{ type: "text", text: "0: https://example.com/form" }] };
      }
      if (name === "browser_evaluate") {
        return { content: [{ type: "text", text: "{\"isSubmitElement\":true,\"wouldSubmit\":true}" }] };
      }
      if (name === "browser_click") {
        return { content: [{ type: "text", text: "clicked" }] };
      }
      return { content: [] };
    });
    const controller = new BrowserSecurityController(store, rawCall);
    await controller.putPolicy(defaultPolicy());

    await expect(controller.callExposedTool("browser_click", { element: "Submit button" })).rejects.toThrow(/structural submit probe/i);
    expect(rawCall).not.toHaveBeenCalledWith("browser_click", expect.anything());

    const audits = readAudit(store);
    const blocked = audits.find((a) => a.action === "submit" && a.verdict === "blocked");
    expect(blocked).toBeDefined();
    expect(blocked?.severity).toBe("high");
    expect(blocked?.details?.submitProbe).toEqual({
      source: "target-probe",
      isSubmitElement: true,
      wouldSubmit: true,
    });
  });

  test("blocks large type payload when allowPost=false and audits length only", async () => {
    const rawCall = vi.fn(async (name: string) => {
      if (name === "browser_tab_list") {
        return { content: [{ type: "text", text: "https://example.com/editor" }] };
      }
      return { content: [] };
    });
    const controller = new BrowserSecurityController(store, rawCall);
    const policy = defaultPolicy();
    policy.largePasteThresholdBytes = 8;
    await controller.putPolicy(policy);

    await expect(controller.callExposedTool("browser_type", {
      element: "Message field",
      text: "very long secret payload",
    })).rejects.toThrow(/Large type blocked/i);

    const audits = readAudit(store);
    const blocked = audits.find((a) => a.action === "large_paste");
    expect(blocked?.severity).toBe("high");
    expect(blocked?.details).toEqual({
      length: Buffer.byteLength("very long secret payload", "utf8"),
      kind: "type",
    });
  });

  test("allows submit-like click when allowPost=true and current URL is recovered by internal probe", async () => {
    const rawCall = vi.fn(async (name: string) => {
      if (name === "browser_tab_list") {
        // Simulate a tab list response shape that does not expose a parseable URL in text.
        return { content: [{ type: "text", text: "Active tabs: 1" }] };
      }
      if (name === "browser_run_code") {
        return { content: [{ type: "text", text: "{\"href\":\"http://localhost:8088/form.html\"}" }] };
      }
      if (name === "browser_click") {
        return { content: [{ type: "text", text: "clicked" }] };
      }
      return { content: [] };
    });
    const controller = new BrowserSecurityController(store, rawCall);
    await controller.putPolicy({
      allowAllDomains: false,
      allowedDomains: [{ domain: "localhost", schemes: ["http", "https"], includeSubdomains: true }],
      blockCrossDomainRedirects: true,
      uploadsEnabled: false,
      allowedUploadCollections: ["_uploads"],
      egressRules: [{ domain: "localhost", allowPost: true, allowUpload: false, schemes: ["http", "https"], includeSubdomains: true }],
      uploadConstraints: { maxFileSizeBytes: 1024 * 1024 },
      largePasteThresholdBytes: 32,
    });

    const result = await controller.callExposedTool("browser_click", { element: "Submit button" });
    expect(result.content[0]?.text).toContain("clicked");
    expect(rawCall).toHaveBeenCalledWith("browser_click", { element: "Submit button" });

    const audits = readAudit(store);
    const allowed = audits.find((a) => a.toolName === "browser_click" && a.verdict === "allowed");
    expect(allowed?.domain).toBe("localhost");
    expect(allowed?.url).toBe("http://localhost:8088/form.html");
  });

  test("allowAllDomains enables navigation allowlisting without granting egress", () => {
    const decision = resolveBrowserUrlDecision(
      {
        allowAllDomains: true,
        allowedDomains: [],
        blockCrossDomainRedirects: true,
        uploadsEnabled: false,
        allowedUploadCollections: ["_uploads"],
        egressRules: [],
        uploadConstraints: { maxFileSizeBytes: 1024 * 1024 },
        largePasteThresholdBytes: 32,
      },
      "https://any-domain.example/path",
    );

    expect(decision.allowedDomain).toBe(true);
    expect(decision.allowPost).toBe(false);
    expect(decision.allowUpload).toBe(false);
    expect(decision.reason).toBeNull();
  });

  test("normalizeBrowserPolicy preserves older stored policies that lack allowAllDomains", () => {
    const normalized = normalizeBrowserPolicy({
      allowedDomains: [{ domain: "example.com" }],
      blockCrossDomainRedirects: true,
      uploadsEnabled: false,
      allowedUploadCollections: ["_uploads"],
      egressRules: [],
      uploadConstraints: { maxFileSizeBytes: 1024 * 1024 },
      largePasteThresholdBytes: 32,
    } as BrowserPolicy);

    expect(normalized.allowAllDomains).toBe(false);
    expect(normalized.allowedDomains).toEqual([{ domain: "example.com" }]);
  });

  test("enforces upload collection boundary and writes high-severity audit", async () => {
    const rawCall = vi.fn(async (name: string) => {
      if (name === "browser_tab_list") {
        return { content: [{ type: "text", text: "https://example.com/upload" }] };
      }
      return { content: [] };
    });
    const controller = new BrowserSecurityController(store, rawCall);
    const policy = defaultPolicy();
    policy.uploadsEnabled = true;
    policy.egressRules = [{ domain: "example.com", allowPost: false, allowUpload: true }];
    await controller.putPolicy(policy);

    await expect(controller.vaultUpload({ collection: "_memory", path: "secret.txt" })).rejects.toThrow(/Collection not allowed/i);
    expect(rawCall).not.toHaveBeenCalledWith("browser_file_upload", expect.anything());

    const audits = readAudit(store);
    const blocked = audits.find((a) => a.toolName === "vault_browser_upload" && a.verdict === "blocked");
    expect(blocked?.severity).toBe("high");
    expect(blocked?.collection).toBe("_memory");
  });

  test("allowed vault upload uses hidden upload tool internally and audits high severity", async () => {
    await seedDoc(store, "_uploads", "foo.txt", encodeBrowserUploadBlobEnvelope(Buffer.from([0x68, 0x69]), {
      mimeType: "text/plain",
      originalName: "foo.txt",
    }));

    const rawCall = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "browser_tab_list") {
        return { content: [{ type: "text", text: "https://example.com/upload" }] };
      }
      if (name === "browser_file_upload") {
        expect(Array.isArray(args.paths)).toBe(true);
        expect(String((args.paths as unknown[])[0])).toContain("straja-vault-browser-upload-");
        return { content: [{ type: "text", text: "uploaded" }] };
      }
      return { content: [] };
    });
    const controller = new BrowserSecurityController(store, rawCall);
    const policy = defaultPolicy();
    policy.uploadsEnabled = true;
    policy.egressRules = [{ domain: "example.com", allowPost: false, allowUpload: true }];
    policy.uploadConstraints.allowedExtensions = [".txt"];
    await controller.putPolicy(policy);

    const result = await controller.vaultUpload({ collection: "_uploads", path: "foo.txt" });
    expect(result.content[0]?.text).toContain("uploaded");
    expect(rawCall).toHaveBeenCalledWith("browser_file_upload", expect.any(Object));

    const audits = readAudit(store);
    const allowed = audits.find((a) => a.toolName === "vault_browser_upload" && a.verdict === "allowed");
    expect(allowed?.severity).toBe("high");
    expect(allowed?.collection).toBe("_uploads");
    expect(allowed?.size).toBe(2);
    expect(allowed?.details).toEqual({ stagedEncoding: "base64", mimeType: "text/plain" });
  });
});
