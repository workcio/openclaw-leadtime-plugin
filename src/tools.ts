import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { LeadtimeClient, findOpenApiAction, listOpenApiActions } from "./leadtime-client.js";
import type { LeadtimePluginConfig } from "./config.js";
import type { SessionStore } from "./session-store.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

type JsonSchema = Record<string, unknown>;

const Schema = {
  object: (properties: Record<string, JsonSchema>, required: string[] = Object.keys(properties)): JsonSchema => ({
    type: "object",
    additionalProperties: false,
    required,
    properties,
  }),
  string: (description: string): JsonSchema => ({ type: "string", description }),
  optionalString: (description: string): JsonSchema => ({ type: "string", description }),
  unknown: (): JsonSchema => ({}),
};

const SessionSchema = Schema.object(
  {
    leadtimeSessionId: Schema.string("Leadtime agent session id from the current prompt."),
  },
);

const TaskIdentifierSchema = Schema.object(
  {
    leadtimeSessionId: Schema.string("Leadtime agent session id from the current prompt."),
    taskIdentifier: Schema.optionalString(
      "Task UUID or short number. Defaults to the task from the current Leadtime session.",
    ),
  },
  ["leadtimeSessionId"],
);

export function registerLeadtimeTools(
  api: OpenClawPluginApi,
  config: LeadtimePluginConfig,
  sessions: SessionStore,
): void {
  const resolve = async (runId: string) => {
    const binding = sessions.get(runId);
    if (!binding) {
      for (const bot of config.bots) {
        const client = new LeadtimeClient(config, bot);
        try {
          const context = await client.getSessionContext(runId);
          const task = context.task as Record<string, unknown> | undefined;
          return {
            binding: {
              runId,
              bot,
              taskId:
                typeof task?.id === "string"
                  ? task.id
                  : typeof (context.targets as Record<string, unknown> | undefined)?.taskId === "string"
                    ? ((context.targets as Record<string, unknown>).taskId as string)
                    : undefined,
              taskIdentifier:
                typeof task?.shortNumber === "number"
                  ? String(task.shortNumber)
                  : typeof task?.id === "string"
                    ? task.id
                    : undefined,
              receivedAt: Date.now(),
            },
            client,
          };
        } catch {
          // Try next configured bot; Leadtime authorizes context only for the owning bot.
        }
      }
      throw new Error(`Leadtime session ${runId} is not owned by any configured bot.`);
    }
    return {
      binding,
      client: new LeadtimeClient(config, binding.bot),
    };
  };

  api.registerTool({
    name: "leadtime_get_session_context",
    label: "Leadtime Session Context",
    description: "Read the current Leadtime agent session context, including trigger, task, comments, and history.",
    parameters: SessionSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { client } = await resolve(runId);
      return jsonResult(await client.getSessionContext(runId));
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_read_task",
    label: "Read Leadtime Task",
    description: "Read a Leadtime task by UUID or short number. Defaults to the current session task.",
    parameters: TaskIdentifierSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { binding, client } = await resolve(runId);
      const taskIdentifier =
        optionalString(rawParams, "taskIdentifier") ?? binding.taskIdentifier ?? binding.taskId;
      if (!taskIdentifier) throw new Error("taskIdentifier is required");
      return jsonResult(await client.readTask(taskIdentifier));
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_add_task_comment",
    label: "Add Leadtime Task Comment",
    description: "Add a comment to the current Leadtime task or a specified task.",
    parameters: Schema.object(
      {
        leadtimeSessionId: Schema.string("Leadtime agent session id from the current prompt."),
        taskIdentifier: Schema.optionalString(
          "Task UUID or short number. Defaults to the task from the current Leadtime session.",
        ),
        comment: Schema.string("Comment body in Markdown or HTML."),
      },
      ["leadtimeSessionId", "comment"],
    ),
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { binding, client } = await resolve(runId);
      const taskIdentifier =
        optionalString(rawParams, "taskIdentifier") ?? binding.taskIdentifier ?? binding.taskId;
      if (!taskIdentifier) throw new Error("taskIdentifier is required");
      return jsonResult(await client.addTaskComment(taskIdentifier, requireString(rawParams, "comment")));
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_list_task_statuses",
    label: "List Leadtime Task Statuses",
    description: "List active Leadtime task statuses so the agent can choose a valid status id.",
    parameters: SessionSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { client } = await resolve(runId);
      return jsonResult(await client.listTaskStatuses());
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_update_task_status",
    label: "Update Leadtime Task Status",
    description: "Update the current Leadtime task or a specified task to a valid Leadtime status id.",
    parameters: Schema.object(
      {
        leadtimeSessionId: Schema.string("Leadtime agent session id from the current prompt."),
        taskIdentifier: Schema.optionalString(
          "Task UUID or short number. Defaults to the task from the current Leadtime session.",
        ),
        statusId: Schema.string("Leadtime task status UUID."),
      },
      ["leadtimeSessionId", "statusId"],
    ),
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { binding, client } = await resolve(runId);
      const taskIdentifier =
        optionalString(rawParams, "taskIdentifier") ?? binding.taskIdentifier ?? binding.taskId;
      if (!taskIdentifier) throw new Error("taskIdentifier is required");
      return jsonResult(await client.updateTaskStatus(taskIdentifier, requireString(rawParams, "statusId")));
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_list_actions",
    label: "List Leadtime API Actions",
    description:
      "Full mode only. List public Leadtime API operations discovered from the OpenAPI document.",
    parameters: SessionSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { binding, client } = await resolve(runId);
      assertFullMode(binding.bot.mode);
      return jsonResult(listOpenApiActions(await client.getOpenApiDocument()));
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_action_details",
    label: "Leadtime API Action Details",
    description: "Full mode only. Get OpenAPI details for one Leadtime public API action.",
    parameters: Schema.object(
      {
        leadtimeSessionId: Schema.string("Leadtime agent session id from the current prompt."),
        action: Schema.string("operationId or 'METHOD /path'."),
      },
    ),
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { binding, client } = await resolve(runId);
      assertFullMode(binding.bot.mode);
      const action = findOpenApiAction(await client.getOpenApiDocument(), requireString(rawParams, "action"));
      if (!action) throw new Error("Leadtime API action not found");
      return jsonResult(action);
    },
  } as AnyAgentTool);

  api.registerTool({
    name: "leadtime_execute_action",
    label: "Execute Leadtime API Action",
    description:
      "Full mode only. Execute a Leadtime public API request by method and public path. Use action details first when unsure.",
    parameters: Schema.object(
      {
        leadtimeSessionId: Schema.string("Leadtime agent session id from the current prompt."),
        method: Schema.string("GET, POST, PUT, PATCH, or DELETE."),
        path: Schema.string("Path below /api/public, for example /tasks/123."),
        query: {
          type: "object",
          additionalProperties: {
            oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
        },
        body: Schema.unknown(),
      },
      ["leadtimeSessionId", "method", "path"],
    ),
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const runId = requireString(rawParams, "leadtimeSessionId");
      const { binding, client } = await resolve(runId);
      assertFullMode(binding.bot.mode);
      const method = requireString(rawParams, "method").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new Error("Unsupported method");
      }
      return jsonResult(
        await client.request({
          method,
          path: requireString(rawParams, "path"),
          query: isRecord(rawParams.query) ? (rawParams.query as Record<string, string | number | boolean>) : undefined,
          body: rawParams.body,
        }),
      );
    },
  } as AnyAgentTool);
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertFullMode(mode: string): void {
  if (mode !== "full") {
    throw new Error("This Leadtime bot is configured in basic mode; full API tools are disabled.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResult(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}
