import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedEvalDefaults } from "./evals.js";
import { parseGitHubOAuthClientConfig } from "./github-oauth-config.js";
import { parseGoogleOAuthClientConfig } from "./google-oauth-config.js";

export const DEFAULT_BOOTSTRAP_FILES = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
] as const;

const DEFAULT_MEMORY_CONTENT = `# Memory

Use this file for durable facts worth recalling across sessions.

- User identity, preferences, and communication style
- Ongoing projects, decisions, and constraints
- Stable operating rules that should persist
`;

export const DEFAULT_SYSTEM_COLLECTIONS = [
  "_bootstrap",
  "_calendar",
  "_contacts",
  "_cron",
  "_delivery_queue",
  "_eval_runs",
  "_evals",
  "_editable",
  "_flows",
  "_gdrive",
  "_gmail",
  "_logs",
  "_media",
  "_memory",
  "_screenshots",
  "_sessions",
  "_sessions_store",
  "_subagents",
  "_tasks",
  "_uploads",
  "_workspace",
  "_write_queue",
] as const;

type SeedStore = {
  findActiveDocument: (collectionName: string, path: string) => { id: number; hash: string; title: string } | null;
  getDocumentWithContent: (
    collectionName: string,
    path: string,
  ) => { id: number; hash: string; title: string; content: string } | null;
  insertContent: (hash: string, content: string, createdAt: string) => void;
  insertDocument: (
    collectionName: string,
    path: string,
    title: string,
    hash: string,
    createdAt: string,
    modifiedAt: string,
    origin?: string,
  ) => void;
  updateDocument: (documentId: number, title: string, hash: string, modifiedAt: string) => void;
};

type BootstrapTemplate = {
  filename: (typeof DEFAULT_BOOTSTRAP_FILES)[number];
  content: string;
};

type GoogleOAuthSeed = {
  clientId: string;
  clientSecret: string;
};

function resolveBootstrapTemplatesDir(): string {
  const override = process.env.STRAJA_BOOTSTRAP_TEMPLATES_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "../../straja-agent/docs/reference/templates");
}

function resolveWorkspaceEnvPath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "../.env");
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }
  const env: Record<string, string> = {};
  const content = readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    env[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function loadSeedGoogleOAuthConfig(): GoogleOAuthSeed | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const templatePath = process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR?.trim()
    ? resolve(process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR.trim(), "google-oauth.json")
    : resolve(thisDir, "../../straja-workspace-app/templates/app/google-oauth.json");

  if (existsSync(templatePath)) {
    try {
      const parsed = parseGoogleOAuthClientConfig(JSON.parse(readFileSync(templatePath, "utf-8")));
      if (parsed) {
        return parsed;
      }
    } catch {
      // Ignore invalid template and continue to the .env fallback for local dev.
    }
  }

  const env = parseEnvFile(resolveWorkspaceEnvPath());
  const fromEnv = parseGoogleOAuthClientConfig({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
  });
  return fromEnv;
}

function loadSeedGitHubOAuthConfig(): GoogleOAuthSeed | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const templatePath = process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR?.trim()
    ? resolve(process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR.trim(), "github-oauth.json")
    : resolve(thisDir, "../../straja-workspace-app/templates/app/github-oauth.json");

  if (existsSync(templatePath)) {
    try {
      const parsed = parseGitHubOAuthClientConfig(JSON.parse(readFileSync(templatePath, "utf-8")));
      if (parsed) {
        return parsed;
      }
    } catch {
      // Ignore invalid template and continue to the .env fallback for local dev.
    }
  }

  const env = parseEnvFile(resolveWorkspaceEnvPath());
  const fromEnv = parseGitHubOAuthClientConfig({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  });
  return fromEnv;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function upsertDocument(
  store: SeedStore,
  params: {
    collection: string;
    path: string;
    content: string;
    now: string;
  },
): void {
  const hash = hashContent(params.content);
  const title = titleFromFilename(params.path);
  const existing = store.getDocumentWithContent(params.collection, params.path);
  if (existing?.hash === hash) {
    return;
  }
  store.insertContent(hash, params.content, params.now);
  if (existing) {
    store.updateDocument(existing.id, title, hash, params.now);
    return;
  }
  store.insertDocument(params.collection, params.path, title, hash, params.now, params.now, "system-init");
}

export function loadDefaultBootstrapTemplates(): BootstrapTemplate[] {
  const templatesDir = resolveBootstrapTemplatesDir();
  return DEFAULT_BOOTSTRAP_FILES.map((filename) => {
    const templatePath = resolve(templatesDir, filename);
    if (!existsSync(templatePath)) {
      throw new Error(`Missing bootstrap template: ${templatePath}`);
    }
    return {
      filename,
      content: readFileSync(templatePath, "utf-8"),
    };
  });
}

export async function seedWorkspaceDefaults(store: SeedStore): Promise<void> {
  const templates = loadDefaultBootstrapTemplates();
  const now = new Date().toISOString();
  for (const template of templates) {
    upsertDocument(store, {
      collection: "_bootstrap",
      path: template.filename,
      content: template.content,
      now,
    });
    upsertDocument(store, {
      collection: "_workspace",
      path: template.filename,
      content: template.content,
      now,
    });
  }

  upsertDocument(store, {
    collection: "_memory",
    path: "MEMORY.md",
    content: DEFAULT_MEMORY_CONTENT,
    now,
  });

  const googleOAuth = loadSeedGoogleOAuthConfig();
  if (googleOAuth) {
    upsertDocument(store, {
      collection: "_config",
      path: "google-oauth.json",
      content: `${JSON.stringify(googleOAuth, null, 2)}\n`,
      now,
    });
  }

  const githubOAuth = loadSeedGitHubOAuthConfig();
  if (githubOAuth) {
    upsertDocument(store, {
      collection: "_config",
      path: "github-oauth.json",
      content: `${JSON.stringify(githubOAuth, null, 2)}\n`,
      now,
    });
  }

  seedEvalDefaults(store);
}
