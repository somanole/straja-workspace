import { describe, expect, it } from "vitest";
import {
  createOpenAICodexOAuthSession,
  extractOpenAICodexAccountId,
  OPENAI_CODEX_REDIRECT_URI,
} from "../src/openai-codex-oauth.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(payload))
    .toString("base64url");
  return `${header}.${body}.sig`;
}

describe("openai-codex-oauth", () => {
  it("builds an authorization URL with PKCE and the provided callback", async () => {
    const session = await createOpenAICodexOAuthSession({
      redirectUri: "http://localhost:8181/connections/agents/openai/callback",
      originator: "vault",
    });

    expect(session.state).toHaveLength(32);
    expect(session.verifier.length).toBeGreaterThan(20);

    const authUrl = new URL(session.authUrl);
    expect(authUrl.origin).toBe("https://auth.openai.com");
    expect(authUrl.pathname).toBe("/oauth/authorize");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8181/connections/agents/openai/callback",
    );
    expect(authUrl.searchParams.get("state")).toBe(session.state);
    expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authUrl.searchParams.get("originator")).toBe("vault");
  });

  it("exports the fixed localhost callback used by the codex oauth client", () => {
    expect(OPENAI_CODEX_REDIRECT_URI).toBe("http://localhost:1455/auth/callback");
  });

  it("extracts the ChatGPT account id from the access token jwt", () => {
    const jwt = makeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc_123",
      },
    });

    expect(extractOpenAICodexAccountId(jwt)).toBe("acc_123");
  });

  it("returns null when the jwt does not include an account id", () => {
    const jwt = makeJwt({ sub: "user_1" });
    expect(extractOpenAICodexAccountId(jwt)).toBeNull();
  });
});
