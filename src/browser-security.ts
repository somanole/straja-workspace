import { extname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Store } from "./store.js";
import { appendAuditEntry, getAudit as getAuditGeneric, nowIso } from "./audit.js";
import { decodeBrowserUploadBlobEnvelope } from "./browser-upload-staging.js";
import {
  getBrowserPolicy,
  loadBrowserPolicy,
  resetBrowserPolicy,
  replaceBrowserPolicy,
  resolveBrowserUrlDecision,
  type BrowserPolicy,
  type BrowserPolicyPatch,
  type BrowserUrlDecision,
  updateBrowserPolicy,
} from "./browser-policy.js";

export type BrowserToolCallArgs = Record<string, unknown>;
export type BrowserToolContentItem = { type: string; text?: string; data?: string; mimeType?: string };
export type BrowserToolCallResult = { content: BrowserToolContentItem[]; [k: string]: unknown };

type BrowserToolRawCaller = (name: string, args: BrowserToolCallArgs) => Promise<BrowserToolCallResult>;
type BrowserToolRawLister = () => Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
type BrowserSecurityLogger = (msg: string) => void;

type SubmitProbeFlags = {
  isSubmitElement: boolean;
  wouldSubmit: boolean;
};

type SubmitProbeResult = SubmitProbeFlags & {
  source: "target-probe" | "active-element-probe";
};

export const EXPOSED_PLAYWRIGHT_BROWSER_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_select_option",
  "browser_hover",
  "browser_press_key",
  "browser_take_screenshot",
  "browser_tab_list",
  "browser_tab_new",
  "browser_tab_close",
  "browser_tabs",
  "browser_console_messages",
  "browser_wait_for",
  "browser_pdf_save",
  "browser_handle_dialog",
] as const;

export const EXPOSED_PLAYWRIGHT_BROWSER_TOOL_SET = new Set<string>(EXPOSED_PLAYWRIGHT_BROWSER_TOOLS);

export const HIDDEN_PLAYWRIGHT_BROWSER_TOOLS = new Set<string>([
  "browser_file_upload",
  "browser_evaluate",
  "browser_run_code",
]);

export type BrowserAuditEntry = {
  timestamp: string;
  toolName: string;
  domain: string | null;
  url: string | null;
  action: string;
  verdict: "allowed" | "blocked" | "error";
  reason: string;
  collection?: string;
  size?: number;
  severity?: "low" | "medium" | "high";
  path?: string;
  details?: Record<string, unknown>;
};

export type BrowserUploadRequest = {
  collection: string;
  path: string;
};

class BrowserPolicyBlockedError extends Error {}

function trimUrlToken(url: string): string {
  return url.replace(/[),.;\]]+$/g, "");
}

function extractText(result: BrowserToolCallResult | null | undefined): string {
  if (!result?.content?.length) return "";
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const url = trimUrlToken(m);
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function collectStringsDeep(value: unknown, out: string[], seen: Set<object>, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as object;
  if (seen.has(obj)) return;
  seen.add(obj);
  if (Array.isArray(value)) {
    for (const item of value) collectStringsDeep(item, out, seen, depth + 1);
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    collectStringsDeep(v, out, seen, depth + 1);
  }
}

function extractUrlsFromResult(result: BrowserToolCallResult | null | undefined): string[] {
  const fromText = extractUrlsFromText(extractText(result));
  if (fromText.length > 0) return fromText;
  if (!result) return [];
  const strings: string[] = [];
  collectStringsDeep(result, strings, new Set<object>());
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const s of strings) {
    for (const url of extractUrlsFromText(s)) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function tryUrl(urlText: string | null | undefined): URL | null {
  if (!urlText) return null;
  try {
    return new URL(urlText);
  } catch {
    return null;
  }
}

function normalizeHost(urlText: string | null | undefined): string | null {
  const url = tryUrl(urlText);
  return url ? url.hostname.toLowerCase() : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isEnterKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.toLowerCase().includes("enter");
}

function isPasteShortcut(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.toLowerCase().replace(/\s+/g, "");
  return s.includes("+v") && (s.includes("control") || s.includes("ctrl") || s.includes("meta") || s.includes("cmd"));
}

function toolAction(toolName: string): string {
  switch (toolName) {
    case "browser_navigate":
    case "browser_tab_new":
      return "navigate";
    case "browser_tabs":
      return "tabs";
    case "browser_click":
      return "click";
    case "browser_type":
      return "type";
    case "browser_fill":
      return "fill";
    case "browser_press_key":
      return "press_key";
    case "browser_select_option":
      return "select";
    case "browser_file_upload":
      return "upload";
    default:
      return "browser_tool";
  }
}

function targetTextForClick(args: BrowserToolCallArgs): string {
  return [asString(args.ref), asString(args.element)].filter(Boolean).join(" ").toLowerCase();
}

function isButtonLikeClick(args: BrowserToolCallArgs): boolean {
  const t = targetTextForClick(args);
  return /\bbutton\b/.test(t);
}

function looksLikeSubmitClick(args: BrowserToolCallArgs): boolean {
  const t = targetTextForClick(args);
  return /\b(submit|send|post|publish|pay|checkout|save|apply|confirm|continue|login|log in|sign in)\b/.test(t);
}

function byteLengthUtf8(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function extensionAllowed(filename: string, allowedExtensions?: string[]): boolean {
  if (!allowedExtensions?.length) return true;
  const ext = extname(filename).toLowerCase();
  return allowedExtensions.includes(ext);
}


function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced.trim());
      return asRecord(parsed);
    } catch {
      // fall through
    }
  }

  const jsonLike = trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonLike) return null;
  try {
    const parsed = JSON.parse(jsonLike);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function parseSubmitProbeResultText(text: string, source: SubmitProbeResult["source"]): SubmitProbeResult | null {
  const obj = parseJsonObjectFromText(text);
  if (!obj) return null;
  const isSubmitElement = asBoolean(obj.isSubmitElement);
  const wouldSubmit = asBoolean(obj.wouldSubmit);
  if (isSubmitElement === null || wouldSubmit === null) return null;
  return { isSubmitElement, wouldSubmit, source };
}

function parseCurrentUrlProbeResultText(text: string): string | null {
  const obj = parseJsonObjectFromText(text);
  if (obj) {
    const href = asString(obj.href);
    if (href && tryUrl(href)) return href;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (tryUrl(trimmed)) return trimmed;
  return extractUrlsFromText(trimmed)[0] ?? null;
}

const TARGET_SUBMIT_PROBE_FUNCTION = `(element) => {
  const el = element instanceof Element ? element : null;
  const type = el instanceof HTMLElement && "type" in el ? String((el as HTMLInputElement).type || "").toLowerCase() : "";
  const tag = el?.tagName?.toLowerCase() || "";
  const form = el instanceof HTMLElement ? el.form ?? el.closest("form") : null;
  const isButton = tag === "button";
  const isInput = tag === "input";
  const isSubmitElement =
    (isButton && (type === "" || type === "submit")) ||
    (isInput && (type === "submit" || type === "image"));
  const wouldSubmit = !!form && isSubmitElement;
  return JSON.stringify({ isSubmitElement, wouldSubmit });
}`;

const ACTIVE_ENTER_SUBMIT_PROBE_CODE = `(() => {
  const el = document.activeElement instanceof Element ? document.activeElement : null;
  const tag = el?.tagName?.toLowerCase() || "";
  const type = el instanceof HTMLElement && "type" in el ? String((el as HTMLInputElement).type || "").toLowerCase() : "";
  const form = el instanceof HTMLElement ? el.closest("form") : null;
  const isSubmitElement =
    (tag === "button" && (type === "" || type === "submit")) ||
    (tag === "input" && (type === "submit" || type === "image"));
  const isTextarea = tag === "textarea";
  const isContentEditable = !!(el instanceof HTMLElement && el.isContentEditable);
  const wouldSubmit =
    !!form &&
    !isTextarea &&
    !isContentEditable &&
    tag !== "button";
  return JSON.stringify({ isSubmitElement, wouldSubmit });
})()`;

const CURRENT_URL_PROBE_CODE = `(() => {
  try {
    const href = typeof window !== "undefined" && window.location ? String(window.location.href || "") : "";
    return JSON.stringify({ href });
  } catch {
    return JSON.stringify({ href: "" });
  }
})()`;


function isNavigationTool(toolName: string, args: BrowserToolCallArgs): boolean {
  return (
    toolName === "browser_navigate" ||
    (toolName === "browser_tab_new" && typeof args.url === "string") ||
    (toolName === "browser_tabs" && args.action === "select")
  );
}

function requiresPostGate(toolName: string, args: BrowserToolCallArgs): { shouldGate: boolean; reason: string } {
  if (toolName === "browser_type" && args.submit === true) {
    return { shouldGate: true, reason: "Type with submit=true can submit a form" };
  }
  if (toolName === "browser_press_key" && isEnterKey(args.key)) {
    return { shouldGate: true, reason: "Enter key may submit a form" };
  }
  if (toolName === "browser_click") {
    if (looksLikeSubmitClick(args)) return { shouldGate: true, reason: "Submit-like click blocked when posting disabled" };
    if (isButtonLikeClick(args)) return { shouldGate: true, reason: "Button clicks blocked when posting disabled" };
  }
  return { shouldGate: false, reason: "" };
}

function extractLargeInput(toolName: string, args: BrowserToolCallArgs): { kind: string; length: number } | null {
  if (toolName === "browser_type" && typeof args.text === "string") {
    return { kind: "type", length: byteLengthUtf8(args.text) };
  }
  if (toolName === "browser_fill" && typeof args.value === "string") {
    return { kind: "fill", length: byteLengthUtf8(args.value) };
  }
  return null;
}

function requestedNavigationUrl(toolName: string, args: BrowserToolCallArgs): string | null {
  if (toolName === "browser_navigate" && typeof args.url === "string") return args.url;
  if (toolName === "browser_tab_new" && typeof args.url === "string") return args.url;
  return null;
}

export class BrowserSecurityController {
  private lastKnownUrl: string | null = null;
  private hiddenSubmitProbeUnavailable = false;

  constructor(
    private readonly store: Store,
    private readonly rawCallTool: BrowserToolRawCaller,
    private readonly rawListTools: BrowserToolRawLister | null = null,
    private readonly logger: BrowserSecurityLogger | null = null,
  ) {
    loadBrowserPolicy(store);
  }

  private log(message: string): void {
    if (this.logger) this.logger(message);
  }

  private async tryInternalToolCall(name: "browser_evaluate" | "browser_run_code", args: BrowserToolCallArgs): Promise<BrowserToolCallResult | null> {
    try {
      return await this.rawCallTool(name, args);
    } catch (err) {
      this.log(`internal browser probe ${name} failed: ${String(err)}`);
      return null;
    }
  }

  private async probeTargetSubmitAction(args: BrowserToolCallArgs): Promise<SubmitProbeResult | null> {
    if (this.hiddenSubmitProbeUnavailable) return null;
    const selectorArgs: BrowserToolCallArgs = {};
    if (typeof args.element === "string") selectorArgs.element = args.element;
    if (typeof args.ref === "string") selectorArgs.ref = args.ref;
    if (!("element" in selectorArgs) && !("ref" in selectorArgs)) return null;

    const candidates: BrowserToolCallArgs[] = [
      { ...selectorArgs, function: TARGET_SUBMIT_PROBE_FUNCTION },
      { ...selectorArgs, expression: `(${TARGET_SUBMIT_PROBE_FUNCTION})(element)` },
      { ...selectorArgs, code: TARGET_SUBMIT_PROBE_FUNCTION },
      { ...selectorArgs, script: TARGET_SUBMIT_PROBE_FUNCTION },
    ];

    for (const candidate of candidates) {
      const result = await this.tryInternalToolCall("browser_evaluate", candidate);
      if (!result) continue;
      const parsed = parseSubmitProbeResultText(extractText(result), "target-probe");
      if (parsed) return parsed;
    }
    return null;
  }

  private async probeActiveElementEnterSubmit(): Promise<SubmitProbeResult | null> {
    if (this.hiddenSubmitProbeUnavailable) return null;
    const candidates: BrowserToolCallArgs[] = [
      { code: ACTIVE_ENTER_SUBMIT_PROBE_CODE },
      { script: ACTIVE_ENTER_SUBMIT_PROBE_CODE },
      { javascript: ACTIVE_ENTER_SUBMIT_PROBE_CODE },
      { expression: ACTIVE_ENTER_SUBMIT_PROBE_CODE },
    ];
    for (const candidate of candidates) {
      const result = await this.tryInternalToolCall("browser_run_code", candidate);
      if (!result) continue;
      const parsed = parseSubmitProbeResultText(extractText(result), "active-element-probe");
      if (parsed) return parsed;
    }
    this.hiddenSubmitProbeUnavailable = true;
    return null;
  }

  private async probeSubmitAction(toolName: string, args: BrowserToolCallArgs): Promise<SubmitProbeResult | null> {
    if (toolName === "browser_click") {
      return this.probeTargetSubmitAction(args);
    }
    if (toolName === "browser_type" && args.submit === true) {
      return (await this.probeTargetSubmitAction(args)) ?? (await this.probeActiveElementEnterSubmit());
    }
    if (toolName === "browser_press_key" && isEnterKey(args.key)) {
      return this.probeActiveElementEnterSubmit();
    }
    return null;
  }

  getPolicy(): BrowserPolicy {
    return getBrowserPolicy();
  }

  // ---- One-time domain approvals (in-memory, consumed after use) ----

  private readonly oneTimeApprovals = new Map<string, number>(); // domain → timestamp

  approveOnce(hostname: string): void {
    this.oneTimeApprovals.set(hostname.toLowerCase().replace(/\.+$/, ""), Date.now());
  }

  private consumeOneTimeApproval(hostname: string): boolean {
    const key = hostname.toLowerCase().replace(/\.+$/, "");
    const ts = this.oneTimeApprovals.get(key);
    if (!ts) return false;
    if (Date.now() - ts > 5 * 60_000) {
      this.oneTimeApprovals.delete(key);
      return false;
    }
    this.oneTimeApprovals.delete(key);
    return true;
  }

  // ---- One-time POST approvals (in-memory, consumed after use) ----

  private readonly oneTimePostApprovals = new Map<string, number>(); // domain → timestamp

  postApproveOnce(hostname: string): void {
    this.oneTimePostApprovals.set(hostname.toLowerCase().replace(/\.+$/, ""), Date.now());
  }

  private consumeOneTimePostApproval(hostname: string): boolean {
    const key = hostname.toLowerCase().replace(/\.+$/, "");
    const ts = this.oneTimePostApprovals.get(key);
    if (!ts) return false;
    if (Date.now() - ts > 5 * 60_000) {
      this.oneTimePostApprovals.delete(key);
      return false;
    }
    this.oneTimePostApprovals.delete(key);
    return true;
  }

  // ---- Egress rule helpers ----

  async addEgressRule(hostname: string): Promise<void> {
    const normalized = hostname.toLowerCase().replace(/\.+$/, "");
    const policy = this.getPolicy();
    const exists = policy.egressRules.some(
      (r) => r.domain.toLowerCase().replace(/\.+$/, "") === normalized,
    );
    if (!exists) {
      policy.egressRules.push({ domain: normalized, includeSubdomains: true, allowPost: true });
      await this.patchPolicy({ egressRules: policy.egressRules });
    }
  }

  async removeEgressRule(hostname: string): Promise<boolean> {
    const normalized = hostname.toLowerCase().replace(/\.+$/, "");
    const policy = this.getPolicy();
    const filtered = policy.egressRules.filter(
      (r) => r.domain.toLowerCase().replace(/\.+$/, "") !== normalized,
    );
    if (filtered.length < policy.egressRules.length) {
      await this.patchPolicy({ egressRules: filtered });
      return true;
    }
    return false;
  }

  async patchPolicy(patch: BrowserPolicyPatch): Promise<BrowserPolicy> {
    return updateBrowserPolicy(this.store, patch);
  }

  private async addDomainToPolicy(hostname: string): Promise<void> {
    const normalized = hostname.toLowerCase().replace(/\.+$/, "");
    const policy = this.getPolicy();
    const exists = policy.allowedDomains.some(
      (r) => r.domain.toLowerCase() === normalized,
    );
    if (!exists) {
      policy.allowedDomains.push({ domain: normalized, includeSubdomains: true });
      await this.patchPolicy({ allowedDomains: policy.allowedDomains });
    }
  }

  async putPolicy(policy: BrowserPolicy): Promise<BrowserPolicy> {
    return replaceBrowserPolicy(this.store, policy);
  }

  async resetPolicy(): Promise<BrowserPolicy> {
    return resetBrowserPolicy(this.store);
  }

  async listExposedTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    if (!this.rawListTools) return [];
    const tools = await this.rawListTools();
    return tools.filter((t) => EXPOSED_PLAYWRIGHT_BROWSER_TOOL_SET.has(t.name));
  }

  async getAudit(date?: string): Promise<{ dates: string[]; entries: BrowserAuditEntry[]; date: string | null }> {
    return getAuditGeneric<BrowserAuditEntry>(this.store, "browser", date, "audit_parser");
  }

  private async writeAudit(entry: BrowserAuditEntry): Promise<void> {
    try {
      await appendAuditEntry(this.store, "browser", entry as unknown as Record<string, unknown>);
    } catch (err) {
      this.log(`browser audit write failed: ${String(err)}`);
    }
  }

  private async refreshCurrentUrl(): Promise<string | null> {
    try {
      const result = await this.rawCallTool("browser_tab_list", {});
      const urls = extractUrlsFromResult(result);
      if (urls.length > 0) {
        this.lastKnownUrl = urls[0]!;
      }
    } catch {
      // ignore
    }
    if (!this.lastKnownUrl) {
      await this.probeCurrentUrl();
    }
    return this.lastKnownUrl;
  }

  private async getCurrentUrl(): Promise<string | null> {
    if (this.lastKnownUrl) return this.lastKnownUrl;
    return this.refreshCurrentUrl();
  }

  private async getCurrentUrlDecision(): Promise<BrowserUrlDecision> {
    const policy = this.getPolicy();
    const url = await this.getCurrentUrl();
    return resolveBrowserUrlDecision(policy, url);
  }

  private async probeCurrentUrl(): Promise<string | null> {
    const runCodeCandidates: BrowserToolCallArgs[] = [
      { code: CURRENT_URL_PROBE_CODE },
      { script: CURRENT_URL_PROBE_CODE },
      { javascript: CURRENT_URL_PROBE_CODE },
      { expression: CURRENT_URL_PROBE_CODE },
    ];
    for (const candidate of runCodeCandidates) {
      const result = await this.tryInternalToolCall("browser_run_code", candidate);
      if (!result) continue;
      const parsed = parseCurrentUrlProbeResultText(extractText(result));
      if (!parsed) continue;
      this.lastKnownUrl = parsed;
      return parsed;
    }

    const evalCandidates: BrowserToolCallArgs[] = [
      { expression: "window.location.href" },
      { javascript: "window.location.href" },
      { code: "() => window.location.href" },
      { function: "() => window.location.href" },
    ];
    for (const candidate of evalCandidates) {
      const result = await this.tryInternalToolCall("browser_evaluate", candidate);
      if (!result) continue;
      const parsed = parseCurrentUrlProbeResultText(extractText(result));
      if (!parsed) continue;
      this.lastKnownUrl = parsed;
      return parsed;
    }
    return null;
  }

  private async blockWithAudit(opts: {
    toolName: string;
    action: string;
    reason: string;
    args?: BrowserToolCallArgs;
    url?: string | null;
    decision?: BrowserUrlDecision | null;
    severity?: "low" | "medium" | "high";
    collection?: string;
    size?: number;
    path?: string;
    details?: Record<string, unknown>;
  }): Promise<never> {
    const url = opts.url ?? opts.decision?.url?.toString() ?? null;
    await this.writeAudit({
      timestamp: nowIso(),
      toolName: opts.toolName,
      domain: opts.decision?.domain ?? normalizeHost(url),
      url,
      action: opts.action,
      verdict: "blocked",
      reason: opts.reason,
      severity: opts.severity ?? "medium",
      ...(opts.collection ? { collection: opts.collection } : {}),
      ...(typeof opts.size === "number" ? { size: opts.size } : {}),
      ...(opts.path ? { path: opts.path } : {}),
      ...(opts.details ? { details: opts.details } : {}),
    });
    throw new BrowserPolicyBlockedError(opts.reason);
  }

  private async auditAllow(opts: {
    toolName: string;
    action: string;
    reason: string;
    url?: string | null;
    collection?: string;
    size?: number;
    path?: string;
    details?: Record<string, unknown>;
    severity?: "low" | "medium" | "high";
  }): Promise<void> {
    const url = opts.url ?? this.lastKnownUrl ?? null;
    await this.writeAudit({
      timestamp: nowIso(),
      toolName: opts.toolName,
      domain: normalizeHost(url),
      url,
      action: opts.action,
      verdict: "allowed",
      reason: opts.reason,
      severity: opts.severity ?? "low",
      ...(opts.collection ? { collection: opts.collection } : {}),
      ...(typeof opts.size === "number" ? { size: opts.size } : {}),
      ...(opts.path ? { path: opts.path } : {}),
      ...(opts.details ? { details: opts.details } : {}),
    });
  }

  private async enforceNavigationPreflight(
    toolName: string,
    args: BrowserToolCallArgs,
    context?: { domainApproval?: "once" | "always" },
  ): Promise<{ requestedUrl: string | null }> {
    const requestedUrl = requestedNavigationUrl(toolName, args);
    if (!requestedUrl) return { requestedUrl: null };

    const decision = resolveBrowserUrlDecision(this.getPolicy(), requestedUrl);
    if (!decision.validUrl) {
      await this.blockWithAudit({
        toolName,
        action: "navigate",
        reason: decision.reason ?? "Invalid navigation URL",
        decision,
        url: requestedUrl,
        severity: "high",
      });
    }
    if (!decision.allowedDomain) {
      const domain = decision.domain ?? decision.url?.hostname ?? "unknown";
      if (context?.domainApproval === "always") {
        await this.addDomainToPolicy(domain);
        await this.auditAllow({
          toolName,
          action: "navigate",
          reason: `Domain ${domain} added to allow list`,
          url: requestedUrl,
        });
      } else if (context?.domainApproval === "once" || this.consumeOneTimeApproval(domain)) {
        await this.auditAllow({
          toolName,
          action: "navigate",
          reason: `Domain ${domain} approved (one-time)`,
          url: requestedUrl,
        });
      } else {
        await this.blockWithAudit({
          toolName,
          action: "navigate",
          reason: `Navigation blocked: domain ${domain} is not allowlisted. Ask the user which option they prefer:\n- "approve once" — one-time access (POST /connections/approve-domain {"domain":"${domain}","decision":"once"}, then retry)\n- "approve always" — add ${domain} permanently to the allow list (POST /connections/approve-domain {"domain":"${domain}","decision":"always"}, then retry)`,
          decision,
          url: requestedUrl,
          severity: "high",
        });
      }
    }
    return { requestedUrl };
  }

  private async enforcePostGateIfNeeded(
    toolName: string,
    args: BrowserToolCallArgs,
    context?: { postApproval?: "once" | "always" },
  ): Promise<void> {
    const policy = this.getPolicy();
    let currentDecision = await this.getCurrentUrlDecision();
    if (!currentDecision.url) {
      await this.refreshCurrentUrl();
      currentDecision = resolveBrowserUrlDecision(policy, this.lastKnownUrl);
    }
    const currentUrl = currentDecision.url?.toString() ?? this.lastKnownUrl ?? null;
    const domain = currentDecision.domain ?? currentDecision.url?.hostname ?? null;

    // If posting is already allowed by policy, nothing to gate.
    if (currentDecision.allowPost) return;

    // Check if a one-time or permanent approval should bypass the gate.
    const hasApproval = (): boolean => {
      if (!domain) return false;
      if (context?.postApproval === "always") return true;
      if (context?.postApproval === "once") return true;
      if (this.consumeOneTimePostApproval(domain)) return true;
      return false;
    };

    // Apply "always" approval: add egress rule permanently so future checks pass.
    const applyAlwaysIfNeeded = async (): Promise<void> => {
      if (domain && context?.postApproval === "always") {
        await this.addEgressRule(domain);
        await this.auditAllow({
          toolName,
          action: "post_approval",
          reason: `Egress rule added for ${domain} (permanent post approval)`,
          url: currentUrl,
        });
      }
    };

    const postBlockMessage = (reason: string): string => {
      if (!domain) return reason;
      return `${reason}\n\nTo proceed, ask the user which option they prefer:\n`
        + `- "approve once" — one-time POST access (POST /connections/approve-domain {"domain":"${domain}","decision":"once","capability":"post"}, then retry)\n`
        + `- "approve always" — enable posting on ${domain} permanently (POST /connections/approve-domain {"domain":"${domain}","decision":"always","capability":"post"}, then retry)`;
    };

    const largeInput = extractLargeInput(toolName, args);
    if (largeInput && largeInput.length > policy.largePasteThresholdBytes) {
      if (hasApproval()) {
        await applyAlwaysIfNeeded();
        return;
      }
      await this.blockWithAudit({
        toolName,
        action: "large_paste",
        reason: postBlockMessage(`Large ${largeInput.kind} blocked when posting disabled (length=${largeInput.length})`),
        decision: currentDecision,
        url: currentUrl,
        severity: "high",
        details: { length: largeInput.length, kind: largeInput.kind },
      });
    }

    if (toolName === "browser_press_key" && isPasteShortcut(args.key)) {
      if (hasApproval()) {
        await applyAlwaysIfNeeded();
        return;
      }
      await this.blockWithAudit({
        toolName,
        action: "paste",
        reason: postBlockMessage("Paste shortcut blocked when posting disabled"),
        decision: currentDecision,
        url: currentUrl,
        severity: "medium",
      });
    }

    const submitProbe = await this.probeSubmitAction(toolName, args);
    if (submitProbe?.wouldSubmit) {
      if (hasApproval()) {
        await applyAlwaysIfNeeded();
        return;
      }
      const baseReason = submitProbe.source === "target-probe"
        ? "Form submit blocked by structural submit probe"
        : "Enter-triggered submit blocked by structural submit probe";
      await this.blockWithAudit({
        toolName,
        action: "submit",
        reason: postBlockMessage(baseReason),
        decision: currentDecision,
        url: currentUrl,
        severity: "high",
        details: {
          submitProbe: {
            source: submitProbe.source,
            isSubmitElement: submitProbe.isSubmitElement,
            wouldSubmit: submitProbe.wouldSubmit,
          },
        },
      });
    }

    // Probe produced a structural "no submit" result; skip heuristics to avoid false positives.
    if (submitProbe && !submitProbe.wouldSubmit) {
      return;
    }

    const postGate = requiresPostGate(toolName, args);
    if (postGate.shouldGate) {
      if (hasApproval()) {
        await applyAlwaysIfNeeded();
        return;
      }
      await this.blockWithAudit({
        toolName,
        action: "submit",
        reason: postBlockMessage(postGate.reason),
        decision: currentDecision,
        url: currentUrl,
        severity: "high",
      });
    }
  }

  private async updateLastKnownUrlFromToolResult(toolName: string, args: BrowserToolCallArgs, result: BrowserToolCallResult): Promise<void> {
    if (toolName === "browser_tab_close") {
      await this.refreshCurrentUrl();
      return;
    }
    if (toolName === "browser_tabs" && args.action === "close") {
      await this.refreshCurrentUrl();
      return;
    }

    const requested = requestedNavigationUrl(toolName, args);
    if (requested) {
      // Prefer actual browser tab list after navigation; fall back to parsed result/requested URL.
      const refreshed = await this.refreshCurrentUrl();
      if (refreshed) return;
      this.lastKnownUrl = extractUrlsFromResult(result).slice(-1)[0] ?? requested;
      return;
    }
    if (toolName === "browser_tabs" && (args.action === "new" || args.action === "select")) {
      await this.refreshCurrentUrl();
      return;
    }

    if (toolName === "browser_tab_list") {
      const urls = extractUrlsFromResult(result);
      if (urls.length > 0) this.lastKnownUrl = urls[0]!;
    }
    if (toolName === "browser_tabs" && args.action === "list") {
      const urls = extractUrlsFromResult(result);
      if (urls.length > 0) this.lastKnownUrl = urls[0]!;
    }
  }

  private async enforceNavigationPostflight(
    toolName: string,
    args: BrowserToolCallArgs,
    context?: { domainApproval?: "once" | "always" },
  ): Promise<void> {
    const isTabSelect = toolName === "browser_tabs" && args.action === "select";
    const requestedUrl = requestedNavigationUrl(toolName, args);
    if (!requestedUrl && !isTabSelect) return;

    const policy = this.getPolicy();
    const requested = tryUrl(requestedUrl);
    const finalUrl = await this.getCurrentUrl();
    const finalDecision = resolveBrowserUrlDecision(policy, finalUrl);
    if (!finalDecision.validUrl || !finalDecision.url) {
      return;
    }

    const requestedHost = requested?.hostname?.toLowerCase() ?? null;
    const finalHost = finalDecision.url.hostname.toLowerCase();
    const crossedDomain = !!requestedHost && requestedHost !== finalHost;

    if (!finalDecision.allowedDomain) {
      if (context?.domainApproval === "always") {
        await this.addDomainToPolicy(finalHost);
        await this.auditAllow({
          toolName,
          action: "navigate_redirect",
          reason: `Redirect domain ${finalHost} added to allow list`,
          url: finalDecision.url.toString(),
        });
      } else if (context?.domainApproval === "once" || this.consumeOneTimeApproval(finalHost)) {
        await this.auditAllow({
          toolName,
          action: "navigate_redirect",
          reason: `Redirect domain ${finalHost} approved (one-time)`,
          url: finalDecision.url.toString(),
        });
      } else {
        try {
          await this.rawCallTool("browser_tab_close", {});
        } catch {
          // ignore; best effort neutralization
        }
        this.lastKnownUrl = null;
        await this.blockWithAudit({
          toolName,
          action: "navigate_redirect",
          reason: `Redirect landed on disallowed domain: ${finalHost}`,
          decision: finalDecision,
          url: finalDecision.url.toString(),
          severity: "high",
        });
      }
    }

    if (policy.blockCrossDomainRedirects && crossedDomain) {
      try {
        await this.rawCallTool("browser_tab_close", {});
      } catch {
        // ignore
      }
      this.lastKnownUrl = null;
      await this.blockWithAudit({
        toolName,
        action: "navigate_redirect",
        reason: `Cross-domain redirect blocked: ${requestedHost} -> ${finalHost}`,
        decision: finalDecision,
        url: finalDecision.url.toString(),
        severity: "high",
      });
    }
  }

  async callExposedTool(
    toolName: string,
    args: BrowserToolCallArgs,
    context?: { domainApproval?: "once" | "always"; postApproval?: "once" | "always" },
  ): Promise<BrowserToolCallResult> {
    if (!EXPOSED_PLAYWRIGHT_BROWSER_TOOL_SET.has(toolName)) {
      await this.blockWithAudit({
        toolName,
        action: "tool_call",
        reason: `Browser tool not allowlisted: ${toolName}`,
        severity: "high",
      });
    }

    if (HIDDEN_PLAYWRIGHT_BROWSER_TOOLS.has(toolName)) {
      await this.blockWithAudit({
        toolName,
        action: "tool_call",
        reason: `Hidden browser tool blocked: ${toolName}`,
        severity: "high",
      });
    }

    if (isNavigationTool(toolName, args)) {
      await this.enforceNavigationPreflight(toolName, args, context);
    }

    await this.enforcePostGateIfNeeded(toolName, args, context ? { postApproval: context.postApproval } : undefined);

    try {
      const result = await this.rawCallTool(toolName, args);
      await this.updateLastKnownUrlFromToolResult(toolName, args, result);
      if (isNavigationTool(toolName, args)) {
        await this.enforceNavigationPostflight(toolName, args, context);
      }
      await this.auditAllow({
        toolName,
        action: toolAction(toolName),
        reason: "Allowed by browser policy",
        url: this.lastKnownUrl,
      });
      return result;
    } catch (err: any) {
      if (err instanceof BrowserPolicyBlockedError) {
        throw err;
      }
      await this.writeAudit({
        timestamp: nowIso(),
        toolName,
        domain: normalizeHost(this.lastKnownUrl),
        url: this.lastKnownUrl,
        action: toolAction(toolName),
        verdict: "error",
        reason: err?.message || "Browser tool call failed",
        severity: "medium",
      });
      throw err;
    }
  }

  async vaultUpload(req: BrowserUploadRequest): Promise<BrowserToolCallResult> {
    const collection = String(req.collection || "").trim();
    const path = String(req.path || "").trim();
    const toolName = "vault_browser_upload";
    if (!collection || !path) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: "Upload requires collection and path",
        collection: collection || undefined,
        path: path || undefined,
        severity: "medium",
      });
    }

    const policy = this.getPolicy();
    const currentDecision = await this.getCurrentUrlDecision();
    const currentUrl = currentDecision.url?.toString() ?? this.lastKnownUrl ?? null;

    if (!policy.uploadsEnabled) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: "Uploads are disabled by policy",
        decision: currentDecision,
        url: currentUrl,
        collection,
        path,
        severity: "high",
      });
    }

    if (!currentDecision.allowUpload) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: "Uploads not allowed for current domain",
        decision: currentDecision,
        url: currentUrl,
        collection,
        path,
        severity: "high",
      });
    }

    if (!currentDecision.allowedUploadCollections.includes(collection)) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: `Collection not allowed for upload: ${collection}`,
        decision: currentDecision,
        url: currentUrl,
        collection,
        path,
        severity: "high",
      });
    }

    const doc = this.store.getDocumentWithContent(collection, path);
    if (!doc) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: "Vault file not found",
        decision: currentDecision,
        url: currentUrl,
        collection,
        path,
        severity: "medium",
      });
    }

    const vaultDoc = doc as NonNullable<typeof doc>;
    const stagedBlob = decodeBrowserUploadBlobEnvelope(vaultDoc.content);
    const fileBytes = stagedBlob?.bytes ?? Buffer.from(vaultDoc.content, "utf8");
    const size = stagedBlob?.byteLength ?? fileBytes.byteLength;
    if (size > policy.uploadConstraints.maxFileSizeBytes) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: `File too large (${size} > ${policy.uploadConstraints.maxFileSizeBytes})`,
        decision: currentDecision,
        url: currentUrl,
        collection,
        path,
        size,
        severity: "high",
      });
    }

    if (!extensionAllowed(path, policy.uploadConstraints.allowedExtensions)) {
      await this.blockWithAudit({
        toolName,
        action: "upload",
        reason: `File extension not allowed: ${extname(path) || "(none)"}`,
        decision: currentDecision,
        url: currentUrl,
        collection,
        path,
        size,
        severity: "high",
      });
    }

    const tempDir = await mkdtemp(`${tmpdir()}/straja-vault-browser-upload-`);
    const fileName = path.split("/").filter(Boolean).pop() || "upload.bin";
    const tempPath = `${tempDir}/${fileName}`;

    try {
      await writeFile(tempPath, fileBytes);
      const result = await this.rawCallTool("browser_file_upload", { paths: [tempPath] });
      await this.auditAllow({
        toolName,
        action: "upload",
        reason: "Vault-mediated upload allowed",
        url: currentUrl,
        collection,
        path,
        size,
        severity: "high",
        details: stagedBlob ? { stagedEncoding: "base64", mimeType: stagedBlob.mimeType } : undefined,
      });
      return result;
    } catch (err: any) {
      await this.writeAudit({
        timestamp: nowIso(),
        toolName,
        domain: currentDecision.domain,
        url: currentUrl,
        action: "upload",
        verdict: "error",
        reason: err?.message || "Upload failed",
        collection,
        size,
        path,
        severity: "high",
      });
      throw err;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
