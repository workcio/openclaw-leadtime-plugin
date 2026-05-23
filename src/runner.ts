import type { OpenClawPluginApi, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { LeadtimeBotConfig, LeadtimePluginConfig } from "./config.js";
import { LeadtimeClient } from "./leadtime-client.js";

export type LeadtimeWebhookPayload = {
  eventType?: string;
  webhookTimestamp?: string;
  workspaceId?: string;
  agentRunId?: string;
  taskId?: string;
  commentId?: string;
  context?: Record<string, unknown>;
};

export async function dispatchLeadtimeSession(params: {
  config: LeadtimePluginConfig;
  bot: LeadtimeBotConfig;
  payload: LeadtimeWebhookPayload;
  eventId: string;
  logger: PluginLogger;
  runtime: OpenClawPluginApi["runtime"];
}): Promise<void> {
  const runId = params.payload.agentRunId;
  if (!runId) throw new Error("Webhook payload missing agentRunId");

  const client = new LeadtimeClient(params.config, params.bot);
  await client.updateStatus(
    runId,
    "running",
    "OpenClaw accepted the Leadtime session",
    `status-running-${params.eventId}`,
  );
  await client.appendActivity(runId, {
    activityType: "prompt",
    body: "OpenClaw received the Leadtime session webhook and started the configured agent.",
    providerEventId: params.eventId,
    providerEventType: params.payload.eventType,
    idempotencyKey: `webhook-accepted-${params.eventId}`,
    raw: {
      eventType: params.payload.eventType,
      taskId: params.payload.taskId,
      commentId: params.payload.commentId,
      botUserId: params.bot.botUserId,
      mode: params.bot.mode,
    },
  });

  const sessionKey = `leadtime-${runId}`;
  const result = await params.runtime.subagent.run({
    sessionKey,
    lane: params.bot.agentId,
    message: buildAgentMessage({
      config: params.config,
      bot: params.bot,
      payload: params.payload,
      runId,
    }),
    lightContext: true,
    idempotencyKey: `leadtime-${runId}-${params.eventId}`,
  });
  const wait = await params.runtime.subagent.waitForRun({
    runId: result.runId,
    timeoutMs: params.config.runner.timeoutSeconds * 1000,
  });
  const messages = await params.runtime.subagent.getSessionMessages({
    sessionKey,
    limit: 20,
  });

  const agentError = findAgentError(messages.messages);
  if (wait.status === "ok" && !agentError) {
    await client.appendActivity(runId, {
      activityType: "response",
      body: extractAgentResponse(messages.messages) || "OpenClaw agent finished.",
      providerEventId: params.eventId,
      providerEventType: "openclaw.agent.finished",
      idempotencyKey: `openclaw-response-${params.eventId}`,
      raw: {
        openClawRunId: result.runId,
        messages: truncate(JSON.stringify(messages.messages), 20_000),
      },
    });
    await client.updateStatus(runId, "done", "OpenClaw agent finished", `status-done-${params.eventId}`);
    return;
  }

  await client.appendActivity(runId, {
    activityType: "error",
    body: `OpenClaw agent did not finish successfully: ${agentError ?? wait.status}${
      wait.error && !agentError ? `: ${wait.error}` : ""
    }.`,
    providerEventId: params.eventId,
    providerEventType: "openclaw.agent.failed",
    idempotencyKey: `openclaw-error-${params.eventId}`,
    raw: {
      openClawRunId: result.runId,
      wait,
      messages: truncate(JSON.stringify(messages.messages), 20_000),
    },
  });
  await client.updateStatus(
    runId,
    "failed",
    `OpenClaw agent did not finish successfully: ${agentError ?? wait.status}`,
    `status-failed-${params.eventId}`,
  );
}

function buildAgentMessage(params: {
  config: LeadtimePluginConfig;
  bot: LeadtimeBotConfig;
  payload: LeadtimeWebhookPayload;
  runId: string;
}): string {
  const context = params.payload.context ?? {};
  const promptContext =
    typeof context.promptContext === "string"
      ? context.promptContext
      : JSON.stringify(context, null, 2);
  const lines = [
    "You are handling a Leadtime task agent session.",
    "",
    `Leadtime session id: ${params.runId}`,
    `Leadtime API base URL: ${params.config.leadtimeBaseUrl}/public`,
    `Configured mode: ${params.bot.mode}`,
    "",
    "Use Leadtime tools with leadtimeSessionId set to the session id above.",
    "The wrapper reports session status; use task tools to read/update the task and add comments when useful.",
  ];

  if (params.bot.mode === "basic") {
    lines.push(
      "Available Leadtime task tools: leadtime_get_session_context, leadtime_read_task, leadtime_add_task_comment, leadtime_list_task_statuses, leadtime_update_task_status.",
    );
  } else {
    lines.push(
      "Full Leadtime API tools are enabled: leadtime_list_actions, leadtime_action_details, leadtime_execute_action.",
    );
    if (params.bot.exposeRawApiCredentialToAgent) {
      lines.push(
        "",
        "Raw Leadtime API credential exposure is enabled for this bot.",
        `Authorization header: Bearer ${params.bot.botPat}`,
        `OpenAPI document: ${params.config.leadtimeBaseUrl}/public/docs/json`,
      );
    }
  }

  if (params.bot.promptGuidance) {
    lines.push("", "Bot-specific guidance:", params.bot.promptGuidance);
  }

  lines.push("", "Leadtime context:", promptContext);
  return lines.join("\n");
}

function extractAgentResponse(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    const record = message as Record<string, unknown>;
    for (const key of ["text", "message", "response", "reply", "output", "content"]) {
      if (typeof record?.[key] === "string" && record[key]) return record[key] as string;
    }
  }
  return "";
}

function findAgentError(messages: unknown[]): string | null {
  for (const message of [...messages].reverse()) {
    const record = message as Record<string, unknown>;
    if (record?.stopReason === "error") {
      return typeof record.errorMessage === "string" ? record.errorMessage : "agent runtime error";
    }
  }
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
