import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type LeadtimeOpenClawConnectorConfig = {
  webhookPath: string;
  openClawGatewayBaseUrl: string;
  bots: unknown[];
};

export type LeadtimeOpenClawConnectorOptions = {
  host: string;
  port: number;
  config: LeadtimeOpenClawConnectorConfig | (() => LeadtimeOpenClawConnectorConfig);
};

export function startLeadtimeOpenClawConnector(options: LeadtimeOpenClawConnectorOptions): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const config = typeof options.config === "function" ? options.config() : options.config;
      const path = (req.url || "/").split("?", 1)[0] || "/";

      if (req.method === "GET" && (path === "/" || path === "/health")) {
        sendJson(res, 200, {
          ok: true,
          connector: "leadtime-openclaw",
          configured: config.bots.length > 0,
          webhookPath: config.webhookPath,
          openClawGatewayBaseUrl: config.openClawGatewayBaseUrl,
        });
        return;
      }

      if (path !== config.webhookPath) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const rawBody = await readRawBody(req);
      const targetUrl = `${config.openClawGatewayBaseUrl}${config.webhookPath}`;
      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers: forwardHeaders(req.headers),
        body: rawBody.toString("utf8"),
      });
      const body = await upstream.arrayBuffer();
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "content-length": String(body.byteLength),
      });
      res.end(Buffer.from(body));
    } catch (error) {
      sendJson(res, 503, {
        error: "Leadtime OpenClaw connector is not ready",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function stopLeadtimeOpenClawConnector(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function forwardHeaders(headers: IncomingHttpHeaders): Headers {
  const next = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const normalized = key.toLowerCase();
    if (["host", "connection", "content-length", "transfer-encoding"].includes(normalized)) continue;
    next.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return next;
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(encoded.byteLength),
  });
  res.end(encoded);
}
