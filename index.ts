import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { findBotBySecret, parsePluginConfig } from "./src/config.js";
import {
  startLeadtimeOpenClawConnector,
  stopLeadtimeOpenClawConnector,
} from "./src/connector-server.js";
import { readRawBody, sendJson } from "./src/http.js";
import { dispatchLeadtimeSession, type LeadtimeWebhookPayload } from "./src/runner.js";
import { SessionStore } from "./src/session-store.js";
import { verifyLeadtimeWebhookSignature } from "./src/signature.js";
import { registerLeadtimeTools } from "./src/tools.js";

const deliveredEvents = new Set<string>();

export default definePluginEntry({
  id: "leadtime",
  name: "Leadtime",
  description: "Connect Leadtime self-hosted agent sessions to OpenClaw agents.",
  register(api) {
    let config;
    try {
      const configFromEntry = (api.config.plugins?.entries?.[api.id] as
        | { config?: Record<string, unknown> }
        | undefined)?.config;
      const configFromLeadtimeEntry = (api.config.plugins?.entries?.leadtime as
        | { config?: Record<string, unknown> }
        | undefined)?.config;
      const configFromPackageEntry = (api.config.plugins?.entries?.[
        "@workcio/openclaw-leadtime-plugin"
      ] as
        | { config?: Record<string, unknown> }
        | undefined)?.config;
      config = parsePluginConfig(
        api.pluginConfig ?? configFromEntry ?? configFromLeadtimeEntry ?? configFromPackageEntry,
      );
    } catch (error) {
      api.logger.warn(
        `Leadtime plugin is not configured: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    const sessions = new SessionStore();
    const dispatchQueue: Array<{
      bot: (typeof config.bots)[number];
      payload: Parameters<typeof dispatchLeadtimeSession>[0]["payload"];
      eventId: string;
    }> = [];
    let dispatching = false;

    const drainQueue = async () => {
      if (dispatching) return;
      dispatching = true;
      try {
        while (dispatchQueue.length > 0) {
          const item = dispatchQueue.shift();
          if (!item) continue;
          await dispatchLeadtimeSession({
            config,
            bot: item.bot,
            payload: item.payload,
            eventId: item.eventId,
            logger: api.logger,
            runtime: api.runtime,
          });
        }
      } catch (error) {
        api.logger.error(
          `Leadtime OpenClaw queued dispatch failed: ${
            error instanceof Error ? error.stack ?? error.message : String(error)
          }`,
        );
      } finally {
        dispatching = false;
      }
    };

    registerLeadtimeTools(api, config, sessions);

    let dispatchInterval: ReturnType<typeof setInterval> | undefined;
    let connectorServer:
      | Awaited<ReturnType<typeof startLeadtimeOpenClawConnector>>
      | undefined;
    api.registerService({
      id: "leadtime-dispatch-queue",
      async start() {
        dispatchInterval = setInterval(() => {
          void drainQueue();
        }, 500);
        connectorServer = await startLeadtimeOpenClawConnector({
          host: config.connector.host,
          port: config.connector.port,
          config,
        });
        api.logger.info(
          `Leadtime connector listening on http://${config.connector.host}:${config.connector.port}${config.webhookPath}`,
        );
      },
      async stop() {
        if (dispatchInterval) clearInterval(dispatchInterval);
        if (connectorServer) {
          await stopLeadtimeOpenClawConnector(connectorServer);
          connectorServer = undefined;
        }
      },
    });

    api.registerHttpRoute({
      path: config.webhookPath,
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return true;
        }

        const rawBody = await readRawBody(req);
        const eventId = String(req.headers["leadtime-webhook-id"] ?? req.headers["idempotency-key"] ?? "");
        const bot = findBotBySecret(config, (candidate) =>
          verifyLeadtimeWebhookSignature({
            rawBody,
            secret: candidate.webhookSecret,
            headers: {
              signature: req.headers["leadtime-signature"],
              timestamp: req.headers["leadtime-webhook-timestamp"],
            },
          }),
        );

        if (!bot) {
          sendJson(res, 401, { error: "Invalid Leadtime webhook signature" });
          return true;
        }

        if (eventId && deliveredEvents.has(eventId)) {
          sendJson(res, 202, { ok: true, duplicate: true });
          return true;
        }
        if (eventId) deliveredEvents.add(eventId);

        const payload = JSON.parse(rawBody) as LeadtimeWebhookPayload;
        const runId = payload.agentRunId;
        if (!runId) {
          sendJson(res, 400, { error: "agentRunId is required" });
          return true;
        }

        const contextTask = payload.context?.task as Record<string, unknown> | undefined;
        sessions.set({
          runId,
          bot,
          taskId: payload.taskId,
          taskIdentifier:
            typeof contextTask?.shortNumber === "number"
              ? String(contextTask.shortNumber)
              : payload.taskId,
          receivedAt: Date.now(),
        });

        dispatchQueue.push({
          bot,
          payload,
          eventId: eventId || `${runId}-${Date.now()}`,
        });

        sendJson(res, 202, { ok: true, runId });
        return true;
      },
    });
  },
});
