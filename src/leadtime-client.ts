import type { LeadtimeBotConfig, LeadtimePluginConfig } from "./config.js";

export type LeadtimeRequestOptions = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  token?: string;
};

export type LeadtimeActivityType =
  | "thought"
  | "action"
  | "elicitation"
  | "response"
  | "error"
  | "prompt"
  | "log"
  | "modelRequest"
  | "modelResponse"
  | "toolCall"
  | "toolResult";

export type LeadtimeSessionStatus = "queued" | "running" | "done" | "failed" | "canceled";

export class LeadtimeClient {
  constructor(
    private readonly config: LeadtimePluginConfig,
    private readonly bot: LeadtimeBotConfig,
  ) {}

  get publicBaseUrl(): string {
    return `${this.config.leadtimeBaseUrl}/public`;
  }

  async request<T = unknown>(options: LeadtimeRequestOptions): Promise<T> {
    const url = new URL(`${this.publicBaseUrl}${options.path.startsWith("/") ? "" : "/"}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${options.token ?? this.bot.botPat}`,
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new Error(
        `Leadtime ${options.method ?? "GET"} ${url.pathname} failed: ${response.status} ${text.slice(0, 500)}`,
      );
    }
    return payload as T;
  }

  getSessionContext(runId: string) {
    return this.request<Record<string, unknown>>({ path: `/agent-sessions/${runId}/context` });
  }

  appendActivity(
    runId: string,
    activity: {
      activityType: LeadtimeActivityType;
      body: string;
      action?: string;
      parameter?: string;
      result?: string;
      providerEventId?: string;
      providerEventType?: string;
      raw?: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ) {
    return this.request({
      method: "POST",
      path: `/agent-sessions/${runId}/activities`,
      body: activity,
    });
  }

  updateStatus(
    runId: string,
    status: LeadtimeSessionStatus,
    message?: string,
    idempotencyKey?: string,
  ) {
    return this.request({
      method: "PATCH",
      path: `/agent-sessions/${runId}/status`,
      body: { status, message, idempotencyKey },
    });
  }

  readTask(identifier: string) {
    return this.request({ path: `/tasks/${encodeURIComponent(identifier)}` });
  }

  listTaskStatuses() {
    return this.request({ path: "/tasks/statuses" });
  }

  addTaskComment(identifier: string, comment: string) {
    return this.request({
      method: "POST",
      path: `/tasks/${encodeURIComponent(identifier)}/comments`,
      body: { comment },
    });
  }

  updateTaskStatus(identifier: string, statusId: string) {
    return this.request({
      method: "PATCH",
      path: `/tasks/${encodeURIComponent(identifier)}`,
      body: { statusId },
    });
  }

  getOpenApiDocument() {
    return fetch(`${this.publicBaseUrl}/docs/json`, {
      headers: { authorization: `Bearer ${this.bot.botPat}`, accept: "application/json" },
    }).then(async (response) => {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Leadtime OpenAPI document failed: ${response.status} ${text.slice(0, 500)}`);
      }
      return safeJson(text) as Record<string, unknown>;
    });
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export type ApiAction = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
};

export function listOpenApiActions(doc: Record<string, unknown>): ApiAction[] {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const actions: ApiAction[] = [];
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = operation as Record<string, unknown>;
      actions.push({
        operationId: String(op.operationId ?? `${method}_${path.replace(/[^a-z0-9]+/gi, "_")}`),
        method: method.toUpperCase(),
        path,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        description: typeof op.description === "string" ? op.description : undefined,
      });
    }
  }
  return actions.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

export function findOpenApiAction(
  doc: Record<string, unknown>,
  actionName: string,
): (ApiAction & { operation: Record<string, unknown> }) | null {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = operation as Record<string, unknown>;
      const operationId = String(op.operationId ?? `${method}_${path.replace(/[^a-z0-9]+/gi, "_")}`);
      if (operationId === actionName || `${method.toUpperCase()} ${path}` === actionName) {
        return {
          operationId,
          method: method.toUpperCase(),
          path,
          summary: typeof op.summary === "string" ? op.summary : undefined,
          description: typeof op.description === "string" ? op.description : undefined,
          operation: op,
        };
      }
    }
  }
  return null;
}
