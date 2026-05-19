export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

let configuredClient: GoogleOAuthClientConfig | null = null;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseGoogleOAuthClientConfig(value: unknown): GoogleOAuthClientConfig | null {
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

export function setGoogleOAuthClientConfig(config: GoogleOAuthClientConfig | null): void {
  configuredClient = config;
}

export function getGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
  if (!configuredClient) {
    throw new Error("Google OAuth client config is not configured in Vault.");
  }
  return configuredClient;
}

export function hasGoogleOAuthClientConfig(): boolean {
  return !!configuredClient;
}
