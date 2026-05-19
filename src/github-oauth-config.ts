export interface GitHubOAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

let configuredClient: GitHubOAuthClientConfig | null = null;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseGitHubOAuthClientConfig(value: unknown): GitHubOAuthClientConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const clientId = normalize((value as Record<string, unknown>).clientId);
  const clientSecret = normalize((value as Record<string, unknown>).clientSecret);
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

export function setGitHubOAuthClientConfig(config: GitHubOAuthClientConfig | null): void {
  configuredClient = config;
}

export function getGitHubOAuthClientConfig(): GitHubOAuthClientConfig {
  if (!configuredClient) {
    throw new Error("GitHub OAuth client config is not configured in Vault.");
  }
  return configuredClient;
}

export function hasGitHubOAuthClientConfig(): boolean {
  return !!configuredClient;
}
