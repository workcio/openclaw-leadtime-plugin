export type SetupMode = "basic" | "full";

export type SetupBotInput = {
  name?: string;
  botUserId: string;
  botPat: string;
  webhookSecret: string;
  agentId?: string;
  mode?: SetupMode;
  promptGuidance?: string;
  exposeRawApiCredentialToAgent?: boolean;
};

export type SetupInput = {
  leadtimeBaseUrl: string;
  webhookPath?: string;
  gatewayPublicUrl?: string;
  skipBootstrap?: boolean;
  bot: SetupBotInput;
};

export function normalizeLeadtimeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/api")) return trimmed;
  if (trimmed.endsWith("/api/public")) return trimmed.slice(0, -"/public".length);
  return `${trimmed}/api`;
}

export function normalizeWebhookPath(value: string | undefined): string {
  const raw = value?.trim() || "/leadtime/webhook";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "") || "/leadtime/webhook";
}

export function buildWebhookUrl(gatewayPublicUrl: string, webhookPath = "/leadtime/webhook"): string {
  const base = gatewayPublicUrl.trim().replace(/\/+$/, "");
  if (!base) return "";
  return `${base}${normalizeWebhookPath(webhookPath)}`;
}

export function buildOpenClawPluginConfig(input: SetupInput): Record<string, unknown> {
  return {
    leadtimeBaseUrl: normalizeLeadtimeApiBaseUrl(input.leadtimeBaseUrl),
    webhookPath: normalizeWebhookPath(input.webhookPath),
    runner: {
      timeoutSeconds: 900,
      thinking: "minimal",
    },
    bots: [buildOpenClawBotConfig(input.bot)],
  };
}

function buildOpenClawBotConfig(bot: SetupBotInput): Record<string, unknown> {
  return {
    name: bot.name?.trim() || "Leadtime Bot",
    botUserId: bot.botUserId.trim(),
    botPat: bot.botPat.trim(),
    webhookSecret: bot.webhookSecret.trim(),
    agentId: bot.agentId?.trim() || "main",
    mode: bot.mode === "full" ? "full" : "basic",
    promptGuidance: bot.promptGuidance?.trim() || undefined,
    exposeRawApiCredentialToAgent: bot.exposeRawApiCredentialToAgent === true,
  };
}

export function mergeOpenClawConfig(existing: Record<string, unknown>, input: SetupInput): Record<string, unknown> {
  const config = structuredClone(existing);
  const agents = objectAt(config, "agents");
  const defaults = objectAt(agents, "defaults");
  if (input.skipBootstrap !== false) {
    defaults["skipBootstrap"] = true;
  }

  const plugins = objectAt(config, "plugins");
  const entries = objectAt(plugins, "entries");
  const leadtime = objectAt(entries, "leadtime");
  leadtime["enabled"] = true;
  leadtime["config"] = mergeLeadtimePluginConfig(leadtime["config"], input);
  return config;
}

function mergeLeadtimePluginConfig(existing: unknown, input: SetupInput): Record<string, unknown> {
  const previous = existing && typeof existing === "object" && !Array.isArray(existing) ? structuredClone(existing) as Record<string, unknown> : {};
  const nextBot = buildOpenClawBotConfig(input.bot);
  const existingBots = Array.isArray(previous["bots"]) ? previous["bots"] : [];
  const nextBotUserId = String(nextBot["botUserId"]);
  const bots = [
    ...existingBots.filter((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      return String((candidate as Record<string, unknown>)["botUserId"]) !== nextBotUserId;
    }),
    nextBot,
  ];

  return {
    ...previous,
    leadtimeBaseUrl: normalizeLeadtimeApiBaseUrl(input.leadtimeBaseUrl),
    webhookPath: normalizeWebhookPath(input.webhookPath),
    gatewayPublicUrl: input.gatewayPublicUrl?.trim() || previous["gatewayPublicUrl"],
    runner: {
      timeoutSeconds: 900,
      thinking: "minimal",
      ...(previous["runner"] && typeof previous["runner"] === "object" && !Array.isArray(previous["runner"])
        ? previous["runner"] as Record<string, unknown>
        : {}),
    },
    bots,
  };
}

export function buildAgentInstallPrompt(input: {
  leadtimeBaseUrl: string;
  webhookPath?: string;
  gatewayPublicUrl?: string;
  botUserId: string;
  mode?: SetupMode;
  exposeRawApiCredentialToAgent?: boolean;
}): string {
  const webhookPath = normalizeWebhookPath(input.webhookPath);
  const webhookUrl = input.gatewayPublicUrl ? buildWebhookUrl(input.gatewayPublicUrl, webhookPath) : "resolved by the setup wizard";
  return [
    "Install and configure the Leadtime OpenClaw plugin in this OpenClaw gateway.",
    "",
    "Repository: https://github.com/workcio/openclaw-leadtime-plugin",
    `Leadtime API base URL: ${normalizeLeadtimeApiBaseUrl(input.leadtimeBaseUrl)}`,
    `Leadtime bot user id: ${input.botUserId}`,
    `Webhook path: ${webhookPath}`,
    `Webhook URL to save in Leadtime: ${webhookUrl}`,
    `Mode: ${input.mode === "full" ? "full" : "basic"}`,
    `Expose raw Leadtime API credential to the agent: ${input.exposeRawApiCredentialToAgent === true ? "yes" : "no"}`,
    "",
    "Prefer the one-time setup code flow from Leadtime bot settings when available. If only manual credentials are available, ask me for the bot PAT and Leadtime webhook signing secret.",
    "Install the plugin with OpenClaw, patch ~/.openclaw/openclaw.json under plugins.entries.leadtime.config, keep agents.defaults.skipBootstrap=true for this headless connector, and let the setup wizard resolve the gateway public URL from existing config or by asking on the OpenClaw machine.",
    "After restart, verify that the configured webhook URL is reachable from Leadtime and that the plugin route accepts signed Leadtime webhooks.",
  ].join("\n");
}

function objectAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}
