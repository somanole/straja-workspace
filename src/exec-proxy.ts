/**
 * Lightweight HTTP CONNECT proxy for Software Engineer agent execution.
 *
 * Only forwards CONNECT requests to domains on the allowlist. All other
 * connections are rejected with 403. Started on demand when a SE agent
 * exec session runs.
 *
 * Tools like npm, git, curl, and pip respect HTTP_PROXY / HTTPS_PROXY env vars,
 * so setting those to this proxy's address restricts network access at the
 * application layer while nono allows network at the kernel layer.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import { request as httpRequest } from "node:http";

export interface ExecProxyOptions {
  /** Domains that the proxy will forward to. Subdomains are included automatically. */
  allowedDomains: string[];
  /** Listen on this port. 0 = auto-assign. */
  port?: number;
}

export interface ExecProxy {
  /** The port the proxy is listening on. */
  port: number;
  /** Stop the proxy server. */
  stop(): Promise<void>;
}

function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  const normalized = hostname.toLowerCase();
  for (const domain of allowedDomains) {
    const d = domain.toLowerCase();
    if (normalized === d || normalized.endsWith(`.${d}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Start a local proxy server that only forwards to allowed domains.
 * Returns the proxy handle with the assigned port.
 */
export function startExecProxy(options: ExecProxyOptions): Promise<ExecProxy> {
  const { allowedDomains, port = 0 } = options;
  const activeSockets = new Set<Socket>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Plain HTTP request (non-CONNECT) — forward if domain allowed
    const url = req.url ?? "";
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    if (!isDomainAllowed(hostname, allowedDomains)) {
      res.writeHead(403);
      res.end(`Domain not allowed: ${hostname}`);
      return;
    }

    // Forward the HTTP request
    const targetUrl = new URL(url);
    const fwd = httpRequest(url, {
      method: req.method,
      headers: { ...req.headers, host: targetUrl.host },
    }, (proxyRes: IncomingMessage) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    fwd.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Proxy error");
    });
    req.pipe(fwd);
  });

  // Handle CONNECT method (used by HTTPS traffic — git, npm over https)
  server.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const [hostname, portStr] = (req.url ?? "").split(":");
    const targetPort = parseInt(portStr ?? "443", 10);

    if (!hostname || !isDomainAllowed(hostname, allowedDomains)) {
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.end();
      return;
    }

    const serverSocket = connect(targetPort, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        serverSocket.write(head);
      }
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    activeSockets.add(serverSocket);
    activeSockets.add(clientSocket);

    serverSocket.on("error", () => { clientSocket.end(); });
    clientSocket.on("error", () => { serverSocket.end(); });
    serverSocket.on("close", () => { activeSockets.delete(serverSocket); });
    clientSocket.on("close", () => { activeSockets.delete(clientSocket); });
  });

  return new Promise<ExecProxy>((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const assignedPort = typeof addr === "object" && addr ? addr.port : 0;
      resolvePromise({
        port: assignedPort,
        async stop() {
          for (const socket of activeSockets) {
            socket.destroy();
          }
          activeSockets.clear();
          return new Promise<void>((resolve) => {
            server.close(() => resolve());
          });
        },
      });
    });
  });
}
