import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";

export type LeadtimeBotMode = "basic" | "full";

export type LeadtimeBotConfig = {
  name: string;
  botUserId: string;
  botPat: string;
  webhookSecret: string;
  agentId: string;
  mode: LeadtimeBotMode;
  promptGuidance?: string;
  exposeRawApiCredentialToAgent: boolean;
};

export type LeadtimePluginConfig = {
  leadtimeBaseUrl: string;
  webhookPath: string;
  openClawGatewayBaseUrl: string;
  connector: {
    host: string;
    port: number;
  };
  runner: {
    command: string;
    timeoutSeconds: number;
    thinking?: string;
  };
  bots: LeadtimeBotConfig[];
};

function readString(value: unknown, fallback?: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : (fallback ?? "");
}

function readSecret(value: unknown, label: string): string {
  const resolved = normalizeResolvedSecretInputString({
    value,
    path: `plugins.entries.leadtime.config.${label}`,
  });
  if (!resolved) throw new Error(`${label} is required`);
  return resolved;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePath(value: string): string {
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+$/, "") || "/leadtime/webhook";
}

export function parsePluginConfig(raw: Record<string, unknown> | undefined): LeadtimePluginConfig {
  const config = raw ?? {};
  const leadtimeBaseUrl = normalizeBaseUrl(readString(config.leadtimeBaseUrl));
  if (!leadtimeBaseUrl) {
    throw new Error("leadtimeBaseUrl is required");
  }

  const rawRunner = (config.runner ?? {}) as Record<string, unknown>;
  const rawConnector = (config.connector ?? {}) as Record<string, unknown>;
  const rawBots = Array.isArray(config.bots) ? config.bots : [];
  const bots = rawBots.map((entry, index): LeadtimeBotConfig => {
    const rawBot = entry as Record<string, unknown>;
    const botUserId = readString(rawBot.botUserId);
    if (!botUserId) {
      throw new Error(`bots[${index}].botUserId is required`);
    }
    const mode = rawBot.mode === "full" ? "full" : "basic";
    return {
      name: readString(rawBot.name, botUserId),
      botUserId,
      botPat: readSecret(rawBot.botPat, `bots[${index}].botPat`),
      webhookSecret: readSecret(rawBot.webhookSecret, `bots[${index}].webhookSecret`),
      agentId: readString(rawBot.agentId, "main"),
      mode,
      promptGuidance: readString(rawBot.promptGuidance) || undefined,
      exposeRawApiCredentialToAgent: rawBot.exposeRawApiCredentialToAgent === true,
    };
  });

  if (bots.length === 0) {
    throw new Error("At least one Leadtime bot must be configured");
  }

  return {
    leadtimeBaseUrl,
    webhookPath: normalizePath(readString(config.webhookPath, "/leadtime/webhook")),
    openClawGatewayBaseUrl: normalizeBaseUrl(readString(config.openClawGatewayBaseUrl, "http://127.0.0.1:18789")),
    connector: {
      host: readString(rawConnector.host, "0.0.0.0"),
      port:
        typeof rawConnector.port === "number" && Number.isFinite(rawConnector.port)
          ? Math.max(1, Math.min(65535, Math.floor(rawConnector.port)))
          : 9339,
    },
    runner: {
      command: readString(rawRunner.command, "openclaw"),
      timeoutSeconds:
        typeof rawRunner.timeoutSeconds === "number" && Number.isFinite(rawRunner.timeoutSeconds)
          ? Math.max(30, Math.floor(rawRunner.timeoutSeconds))
          : 900,
      thinking: readString(rawRunner.thinking) || undefined,
    },
    bots,
  };
}

export function findBotBySecret(
  config: LeadtimePluginConfig,
  predicate: (bot: LeadtimeBotConfig) => boolean,
): LeadtimeBotConfig | null {
  for (const bot of config.bots) {
    if (predicate(bot)) return bot;
  }
  return null;
}
