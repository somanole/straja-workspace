/**
 * Minimal WebSocket RPC client for the OpenClaw agent gateway (protocol v3).
 *
 * Opens a one-shot WebSocket connection, authenticates with Ed25519 device
 * identity, sends a single RPC request, waits for the response, and closes.
 * Uses the Node.js 22 built-in WebSocket.
 */

import crypto, { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function httpToWs(url: string): string {
  return url.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: crypto.KeyObject;
};

let cachedIdentity: DeviceIdentity | null = null;

function getOrCreateDeviceIdentity(): DeviceIdentity {
  if (cachedIdentity) {
    return cachedIdentity;
  }

  const dir = join(homedir(), ".straja-vault");
  const keyFile = join(dir, "gateway-device-key.json");

  if (existsSync(keyFile)) {
    try {
      const data = JSON.parse(readFileSync(keyFile, "utf8")) as {
        deviceId?: string;
        publicKey?: string;
        privateKey?: string;
      };
      if (typeof data.deviceId === "string" && typeof data.publicKey === "string" && typeof data.privateKey === "string") {
        const privKeyObj = crypto.createPrivateKey({
          key: Buffer.from(data.privateKey, "base64"),
          type: "pkcs8",
          format: "der",
        });
        cachedIdentity = {
          deviceId: data.deviceId,
          publicKey: data.publicKey,
          privateKey: privKeyObj,
        };
        return cachedIdentity;
      }
    } catch {
      // Regenerate on error.
    }
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const publicKeyBase64Url = base64UrlEncode(pubRaw);
  const deviceId = crypto.createHash("sha256").update(pubRaw).digest("hex");
  const privateKeyDer = privateKey.export({ type: "pkcs8", format: "der" });

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    keyFile,
    JSON.stringify(
      {
        deviceId,
        publicKey: publicKeyBase64Url,
        privateKey: Buffer.from(privateKeyDer).toString("base64"),
      },
      null,
      2,
    ),
    "utf8",
  );

  cachedIdentity = {
    deviceId,
    publicKey: publicKeyBase64Url,
    privateKey,
  };
  return cachedIdentity;
}

function signDevicePayload(identity: DeviceIdentity, payload: string): string {
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), identity.privateKey);
  return base64UrlEncode(sig);
}

const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const ROLE = "operator";
const SCOPES = ["operator.read", "operator.write", "operator.admin"];

export async function agentGatewayRpc(
  gatewayUrl: string,
  token: string,
  method: string,
  params?: unknown,
  timeoutMs: number = 15_000,
): Promise<unknown> {
  const wsUrl = httpToWs(gatewayUrl.replace(/\/+$/, ""));
  const identity = getOrCreateDeviceIdentity();

  return new Promise((resolve, reject) => {
    let done = false;
    const rpcId = randomUUID();
    const connectId = randomUUID();

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error(`Agent gateway timeout after ${timeoutMs}ms (method: ${method})`));
      }
    }, timeoutMs);

    const finish = (err: Error | null, result?: unknown) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    };

    const ws = new WebSocket(wsUrl);

    ws.addEventListener("error", (evt: Event) => {
      const msg = (evt as ErrorEvent).message || "WebSocket error";
      finish(new Error(`Agent gateway connection error: ${msg}`));
    });

    ws.addEventListener("close", () => {
      finish(new Error("Agent gateway WebSocket closed unexpectedly"));
    });

    let state: "waiting-for-hello" | "waiting-for-connect-ack" | "waiting-for-rpc" =
      "waiting-for-hello";

    ws.addEventListener("message", (evt: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : String(evt.data));
      } catch {
        return;
      }

      if (state === "waiting-for-hello") {
        const isChallenge =
          (msg.type === "event" && msg.event === "connect.challenge") ||
          (msg.type === "event" && msg.event === "hello-nonce") ||
          msg.type === "connect.challenge";

        if (isChallenge) {
          state = "waiting-for-connect-ack";

          const signedAtMs = Date.now();
          const payload = [
            "v1",
            identity.deviceId,
            CLIENT_ID,
            CLIENT_MODE,
            ROLE,
            SCOPES.join(","),
            String(signedAtMs),
            token,
          ].join("|");
          const signature = signDevicePayload(identity, payload);

          ws.send(
            JSON.stringify({
              type: "req",
              id: connectId,
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: CLIENT_ID,
                  version: "1.0.0",
                  platform: "node",
                  mode: CLIENT_MODE,
                },
                role: ROLE,
                scopes: SCOPES,
                auth: { token },
                device: {
                  id: identity.deviceId,
                  publicKey: identity.publicKey,
                  signature,
                  signedAt: signedAtMs,
                },
              },
            }),
          );
          return;
        }
        return;
      }

      if (state === "waiting-for-connect-ack") {
        const isConnectAck =
          msg.type === "hello-ok" ||
          (msg.type === "event" && msg.event === "hello-ok") ||
          (msg.type === "res" && msg.id === connectId && msg.ok);

        if (isConnectAck) {
          state = "waiting-for-rpc";
          ws.send(
            JSON.stringify({
              type: "req",
              id: rpcId,
              method,
              params: params ?? {},
            }),
          );
          return;
        }

        const isAuthFail =
          msg.type === "hello-error" ||
          (msg.type === "event" && msg.event === "hello-error") ||
          (msg.type === "res" && msg.id === connectId && !msg.ok) ||
          msg.type === "error";

        if (isAuthFail) {
          const errMsg =
            msg.error?.message || msg.payload?.message || msg.message || "Authentication failed";
          finish(new Error(`Agent gateway auth error: ${errMsg}`));
          return;
        }
        return;
      }

      if (state === "waiting-for-rpc" && msg.type === "res" && msg.id === rpcId) {
        if (msg.ok) {
          finish(null, msg.payload);
        } else {
          const errMsg = msg.error?.message || "RPC method failed";
          finish(new Error(`Agent gateway RPC error (${method}): ${errMsg}`));
        }
      }
    });
  });
}
