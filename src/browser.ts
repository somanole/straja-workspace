/**
 * Browser Service — wraps @playwright/mcp to provide runtime-owned browser automation.
 *
 * Manages the lifecycle of a Playwright MCP server: start, stop, config persistence,
 * and tool invocation proxying.
 */

// We use `unknown` for the MCP Server type to avoid CJS/ESM dual-package
// type mismatch. All access is through (server as any)._requestHandlers anyway.
type McpServerHandle = unknown;

// ---------------------------------------------------------------------------
// Config types (stored in _config/browser.json)
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  enabled: boolean;
  headless?: boolean;
  cdpEndpoint?: string;
  userDataDir?: string;
  isolated?: boolean;
  allowedOrigins?: string[];
  blockedOrigins?: string[];
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

let mcpServer: McpServerHandle | null = null;
let currentConfig: BrowserConfig | null = null;

export function isRunning(): boolean {
  return mcpServer !== null;
}

export function getStatus(): {
  status: "not_configured" | "stopped" | "running";
  headless?: boolean;
  cdpEndpoint?: string;
  capabilities?: string[];
} {
  if (!currentConfig) return { status: "not_configured" };
  if (!mcpServer) return { status: "stopped", ...configSummary(currentConfig) };
  return { status: "running", ...configSummary(currentConfig) };
}

function configSummary(cfg: BrowserConfig) {
  return {
    headless: cfg.headless,
    cdpEndpoint: cfg.cdpEndpoint,
    capabilities: cfg.capabilities,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the browser MCP server. Dynamically imports @playwright/mcp
 * so the dependency is optional at load time.
 */
export async function startBrowserService(config: BrowserConfig): Promise<void> {
  if (mcpServer) {
    throw new Error("Browser service is already running");
  }

  const { createConnection } = await import("@playwright/mcp");

  const pwConfig: Record<string, unknown> = {
    browser: {
      browserName: "chromium" as const,
      headless: config.headless ?? false,
      isolated: config.isolated ?? false,
      ...(config.userDataDir ? { userDataDir: config.userDataDir } : {}),
      ...(config.cdpEndpoint ? { cdpEndpoint: config.cdpEndpoint } : {}),
      launchOptions: {
        headless: config.headless ?? false,
      },
    },
    capabilities: config.capabilities ?? [
      "core",
      "core-navigation",
      "core-tabs",
      "core-input",
      "network",
      "pdf",
      "vision",
    ],
    ...(config.allowedOrigins || config.blockedOrigins
      ? {
          network: {
            ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
            ...(config.blockedOrigins ? { blockedOrigins: config.blockedOrigins } : {}),
          },
        }
      : {}),
  };

  mcpServer = await createConnection(pwConfig as any);
  currentConfig = config;
}

/** Stop the browser MCP server and close the browser. */
export async function stopBrowserService(): Promise<void> {
  if (!mcpServer) return;
  try {
    await (mcpServer as any).close();
  } catch {
    // ignore close errors
  }
  mcpServer = null;
}

/** Update the stored config reference (does NOT restart the service). */
export function setConfig(config: BrowserConfig): void {
  currentConfig = config;
}

// ---------------------------------------------------------------------------
// Tool proxying — access the MCP server's internal request handlers
// ---------------------------------------------------------------------------

/**
 * Call a tool on the running playwright-mcp server.
 * Accesses the Server's internal `_requestHandlers` map to invoke the
 * "tools/call" handler directly, bypassing the transport layer.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  if (!mcpServer) {
    throw new Error("Browser service is not running");
  }

  const handler = (mcpServer as any)._requestHandlers?.get?.("tools/call");
  if (!handler) {
    throw new Error("Cannot invoke tool: handler not found (incompatible @playwright/mcp version?)");
  }

  const result = await handler(
    { method: "tools/call", params: { name, arguments: args } },
    { /* RequestHandlerExtra — not needed for playwright-mcp tools */ },
  );
  return result as any;
}

/** List tools available on the running playwright-mcp server. */
export async function listTools(): Promise<
  Array<{ name: string; description?: string; inputSchema?: unknown }>
> {
  if (!mcpServer) {
    throw new Error("Browser service is not running");
  }

  const handler = (mcpServer as any)._requestHandlers?.get?.("tools/list");
  if (!handler) return [];

  const result = await handler({ method: "tools/list", params: {} }, {});
  return (result as any)?.tools ?? [];
}
