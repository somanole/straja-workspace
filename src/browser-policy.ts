import { z } from "zod";
import type { Store } from "./store.js";
import { hashContent } from "./store.js";

export interface DomainRule {
  domain: string;
  includeSubdomains?: boolean;
  schemes?: Array<"http" | "https">;
}

export interface BrowserEgressRule extends DomainRule {
  allowPost?: boolean;
  allowUpload?: boolean;
  uploadCollections?: string[];
}

export interface BrowserUploadConstraints {
  maxFileSizeBytes: number;
  allowedExtensions?: string[];
}

export interface BrowserPolicy {
  allowAllDomains: boolean;
  allowedDomains: DomainRule[];
  blockCrossDomainRedirects: boolean;
  uploadsEnabled: boolean;
  allowedUploadCollections: string[];
  egressRules: BrowserEgressRule[];
  uploadConstraints: BrowserUploadConstraints;
  largePasteThresholdBytes: number;
}

export type BrowserPolicyPatch = Partial<Omit<BrowserPolicy, "uploadConstraints">> & {
  uploadConstraints?: Partial<BrowserUploadConstraints>;
};

const DomainRuleSchema = z.object({
  domain: z.string().min(1),
  includeSubdomains: z.boolean().optional(),
  schemes: z.array(z.enum(["http", "https"])).optional(),
});

const BrowserEgressRuleSchema = DomainRuleSchema.extend({
  allowPost: z.boolean().optional(),
  allowUpload: z.boolean().optional(),
  uploadCollections: z.array(z.string()).optional(),
});

const BrowserUploadConstraintsSchema = z.object({
  maxFileSizeBytes: z.number().int().positive(),
  allowedExtensions: z.array(z.string()).optional(),
});

const BrowserPolicySchema = z.object({
  allowAllDomains: z.boolean().default(false),
  allowedDomains: z.array(DomainRuleSchema),
  blockCrossDomainRedirects: z.boolean(),
  uploadsEnabled: z.boolean(),
  allowedUploadCollections: z.array(z.string()),
  egressRules: z.array(BrowserEgressRuleSchema),
  uploadConstraints: BrowserUploadConstraintsSchema,
  largePasteThresholdBytes: z.number().int().nonnegative(),
});

const BrowserPolicyPatchSchema = z.object({
  allowAllDomains: z.boolean().optional(),
  allowedDomains: z.array(DomainRuleSchema).optional(),
  blockCrossDomainRedirects: z.boolean().optional(),
  uploadsEnabled: z.boolean().optional(),
  allowedUploadCollections: z.array(z.string()).optional(),
  egressRules: z.array(BrowserEgressRuleSchema).optional(),
  uploadConstraints: BrowserUploadConstraintsSchema.partial().optional(),
  largePasteThresholdBytes: z.number().int().nonnegative().optional(),
});

const DEFAULT_BROWSER_POLICY: BrowserPolicy = {
  allowAllDomains: false,
  allowedDomains: [],
  blockCrossDomainRedirects: true,
  uploadsEnabled: false,
  allowedUploadCollections: ["_uploads"],
  egressRules: [],
  uploadConstraints: {
    maxFileSizeBytes: 5 * 1024 * 1024,
  },
  largePasteThresholdBytes: 4096,
};

let cachedPolicy: BrowserPolicy | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeDomainRule<T extends DomainRule>(rule: T): T {
  const domain = normalizeDomain(rule.domain);
  const schemes = rule.schemes?.map((s) => s.toLowerCase() as "http" | "https").filter((v, i, arr) => arr.indexOf(v) === i);
  return {
    ...rule,
    domain,
    ...(schemes?.length ? { schemes } : {}),
  };
}

function normalizeDomain(domain: string): string {
  let normalized = domain.trim().toLowerCase();

  // Accept user-friendly inputs like "http://localhost:8088" or "localhost:8088"
  // while storing/matching on hostname only.
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(normalized)) {
    try {
      normalized = new URL(normalized).hostname.toLowerCase();
    } catch {
      // Fall through to string cleanup below.
    }
  }

  // Strip any accidental path fragment in a rule field.
  if (normalized.includes("/")) {
    normalized = normalized.split("/")[0] ?? normalized;
  }

  // Strip a single host:port suffix (keep IPv6 addresses, which contain multiple colons).
  const colonCount = (normalized.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    normalized = normalized.split(":")[0] ?? normalized;
  }

  return normalized.replace(/\.+$/, "");
}

function normalizeCollectionNames(names: string[] | undefined): string[] | undefined {
  if (!names) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const value = String(raw).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeExtensions(exts: string[] | undefined): string[] | undefined {
  if (!exts) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of exts) {
    let ext = String(raw).trim().toLowerCase();
    if (!ext) continue;
    if (!ext.startsWith(".")) ext = `.${ext}`;
    if (seen.has(ext)) continue;
    seen.add(ext);
    out.push(ext);
  }
  return out.length ? out : undefined;
}

export function normalizeBrowserPolicy(input: BrowserPolicy): BrowserPolicy {
  const parsed = BrowserPolicySchema.parse(input);
  return {
    allowAllDomains: parsed.allowAllDomains,
    allowedDomains: parsed.allowedDomains.map((r) => normalizeDomainRule(r)),
    blockCrossDomainRedirects: parsed.blockCrossDomainRedirects,
    uploadsEnabled: parsed.uploadsEnabled,
    allowedUploadCollections: normalizeCollectionNames(parsed.allowedUploadCollections) ?? ["_uploads"],
    egressRules: parsed.egressRules.map((r) => ({
      ...normalizeDomainRule(r),
      uploadCollections: normalizeCollectionNames(r.uploadCollections),
    })),
    uploadConstraints: {
      maxFileSizeBytes: parsed.uploadConstraints.maxFileSizeBytes,
      allowedExtensions: normalizeExtensions(parsed.uploadConstraints.allowedExtensions),
    },
    largePasteThresholdBytes: parsed.largePasteThresholdBytes,
  };
}

export function getDefaultBrowserPolicy(): BrowserPolicy {
  return clone(DEFAULT_BROWSER_POLICY);
}

export function getBrowserPolicy(): BrowserPolicy {
  return clone(cachedPolicy ?? DEFAULT_BROWSER_POLICY);
}

export function setBrowserPolicyCache(policy: BrowserPolicy): BrowserPolicy {
  cachedPolicy = normalizeBrowserPolicy(policy);
  return getBrowserPolicy();
}

export function loadBrowserPolicy(store: Store): BrowserPolicy {
  const doc = store.getDocumentWithContent("_config", "browser-policy.json");
  if (!doc?.content) {
    cachedPolicy = getDefaultBrowserPolicy();
    return getBrowserPolicy();
  }
  try {
    const parsed = JSON.parse(doc.content);
    cachedPolicy = normalizeBrowserPolicy(parsed);
  } catch {
    // Fail closed if the stored policy is malformed.
    cachedPolicy = getDefaultBrowserPolicy();
  }
  return getBrowserPolicy();
}

function mergePolicy(base: BrowserPolicy, patch: BrowserPolicyPatch): BrowserPolicy {
  const parsedPatch = BrowserPolicyPatchSchema.parse(patch);
  return normalizeBrowserPolicy({
    ...base,
    ...parsedPatch,
    uploadConstraints: {
      ...base.uploadConstraints,
      ...(parsedPatch.uploadConstraints ?? {}),
    },
  });
}

async function persistPolicy(store: Store, policy: BrowserPolicy): Promise<void> {
  const now = new Date().toISOString();
  const content = JSON.stringify(policy, null, 2);
  const hash = await hashContent(content);
  store.insertContent(hash, content, now);
  const existing = store.findActiveDocument("_config", "browser-policy.json");
  if (existing) {
    store.updateDocument(existing.id, "browser-policy.json", hash, now);
  } else {
    store.insertDocument("_config", "browser-policy.json", "browser-policy.json", hash, now, now);
  }
}

export async function updateBrowserPolicy(store: Store, patch: BrowserPolicyPatch): Promise<BrowserPolicy> {
  const current = loadBrowserPolicy(store);
  const next = mergePolicy(current, patch);
  await persistPolicy(store, next);
  cachedPolicy = next;
  return getBrowserPolicy();
}

export async function replaceBrowserPolicy(store: Store, policy: BrowserPolicy): Promise<BrowserPolicy> {
  const normalized = normalizeBrowserPolicy(policy);
  await persistPolicy(store, normalized);
  cachedPolicy = normalized;
  return getBrowserPolicy();
}

export async function resetBrowserPolicy(store: Store): Promise<BrowserPolicy> {
  const next = getDefaultBrowserPolicy();
  await persistPolicy(store, next);
  cachedPolicy = next;
  return getBrowserPolicy();
}

function matchesDomainRule(rule: DomainRule, url: URL): boolean {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (rule.schemes?.length) {
    const scheme = url.protocol.slice(0, -1) as "http" | "https";
    if (!rule.schemes.includes(scheme)) return false;
  }

  const host = normalizeDomain(url.hostname);
  const ruleDomain = normalizeDomain(rule.domain);
  if (host === ruleDomain) return true;
  if (rule.includeSubdomains && host.endsWith(`.${ruleDomain}`)) return true;
  return false;
}

export type BrowserUrlDecision = {
  validUrl: boolean;
  url: URL | null;
  domain: string | null;
  allowedDomain: boolean;
  matchedAllowedDomainRule: DomainRule | null;
  matchedEgressRule: BrowserEgressRule | null;
  allowPost: boolean;
  allowUpload: boolean;
  allowedUploadCollections: string[];
  reason: string | null;
};

export function resolveBrowserUrlDecision(policy: BrowserPolicy, urlText: string | null | undefined): BrowserUrlDecision {
  if (!urlText) {
    return {
      validUrl: false,
      url: null,
      domain: null,
      allowedDomain: false,
      matchedAllowedDomainRule: null,
      matchedEgressRule: null,
      allowPost: false,
      allowUpload: false,
      allowedUploadCollections: normalizeCollectionNames(policy.allowedUploadCollections) ?? [],
      reason: "URL unavailable",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return {
      validUrl: false,
      url: null,
      domain: null,
      allowedDomain: false,
      matchedAllowedDomainRule: null,
      matchedEgressRule: null,
      allowPost: false,
      allowUpload: false,
      allowedUploadCollections: normalizeCollectionNames(policy.allowedUploadCollections) ?? [],
      reason: "Invalid URL",
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      validUrl: false,
      url: parsed,
      domain: normalizeDomain(parsed.hostname),
      allowedDomain: false,
      matchedAllowedDomainRule: null,
      matchedEgressRule: null,
      allowPost: false,
      allowUpload: false,
      allowedUploadCollections: normalizeCollectionNames(policy.allowedUploadCollections) ?? [],
      reason: `Unsupported scheme: ${parsed.protocol}`,
    };
  }

  let matchedAllowedDomainRule: DomainRule | null = null;
  for (const rule of policy.allowedDomains) {
    if (matchesDomainRule(rule, parsed)) matchedAllowedDomainRule = rule;
  }
  const allowedDomain = policy.allowAllDomains || !!matchedAllowedDomainRule;

  let matchedEgressRule: BrowserEgressRule | null = null;
  const matchedEgressRules: BrowserEgressRule[] = [];
  for (const rule of policy.egressRules) {
    if (matchesDomainRule(rule, parsed)) {
      matchedEgressRule = rule; // Preserve last-match for compatibility/introspection.
      matchedEgressRules.push(rule);
    }
  }

  const uploadCollections = new Set<string>(normalizeCollectionNames(policy.allowedUploadCollections) ?? []);
  for (const rule of matchedEgressRules) {
    for (const c of normalizeCollectionNames(rule.uploadCollections) ?? []) {
      uploadCollections.add(c);
    }
  }

  return {
    validUrl: true,
    url: parsed,
    domain: normalizeDomain(parsed.hostname),
    allowedDomain,
    matchedAllowedDomainRule,
    matchedEgressRule,
    allowPost: matchedEgressRules.some((r) => r.allowPost === true),
    allowUpload: matchedEgressRules.some((r) => r.allowUpload === true),
    allowedUploadCollections: Array.from(uploadCollections),
    reason: allowedDomain ? null : "Domain not allowlisted",
  };
}
