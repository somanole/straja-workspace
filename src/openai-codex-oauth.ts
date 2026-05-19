import { createHash, randomBytes } from "node:crypto";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
export const OPENAI_CODEX_CALLBACK_ORIGIN = "http://localhost:1455";
export const OPENAI_CODEX_REDIRECT_URI = `${OPENAI_CODEX_CALLBACK_ORIGIN}/auth/callback`;

export interface OpenAICodexOAuthSession {
  verifier: string;
  state: string;
  redirectUri: string;
  authUrl: string;
}

export interface OpenAICodexOAuthToken {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payload = parts[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractOpenAICodexAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload?.[JWT_CLAIM_PATH];
  if (!authClaim || typeof authClaim !== "object" || Array.isArray(authClaim)) {
    return null;
  }
  const accountId = (authClaim as { chatgpt_account_id?: unknown }).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
}

export async function createOpenAICodexOAuthSession(params: {
  redirectUri: string;
  originator?: string;
}): Promise<OpenAICodexOAuthSession> {
  const verifier = toBase64Url(randomBytes(32));
  const state = randomBytes(16).toString("hex");
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", params.originator?.trim() || "pi");
  return {
    verifier,
    state,
    redirectUri: params.redirectUri,
    authUrl: url.toString(),
  };
}

export async function exchangeOpenAICodexAuthorizationCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<OpenAICodexOAuthToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI token exchange failed (${response.status}): ${text || "unknown error"}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string" ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error("OpenAI token response missing required fields.");
  }

  const accountId = extractOpenAICodexAccountId(json.access_token);
  if (!accountId) {
    throw new Error("Failed to extract ChatGPT account id from OpenAI token.");
  }

  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}
