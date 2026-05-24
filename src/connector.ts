#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startLeadtimeOpenClawConnector } from "./connector-server.js";

type Args = Record<string, string | boolean>;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["help"]) {
    printHelp();
    return;
  }

  const configPath = stringArg(args, "config") || join(homedir(), ".openclaw", "openclaw.json");
  const host = stringArg(args, "host") || "0.0.0.0";
  const port = Number(stringArg(args, "port") || 9339);

  await startLeadtimeOpenClawConnector({
    host,
    port,
    config: () => loadLeadtimeConfig(configPath),
  });
  console.log(`Leadtime OpenClaw connector listening on http://${host}:${port}/leadtime/webhook`);
  console.log(`Config: ${configPath}`);
}

function loadLeadtimeConfig(configPath: string) {
  if (!existsSync(configPath)) {
    throw new Error(`OpenClaw config not found at ${configPath}`);
  }
  const root = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const entries = (((root.plugins as Record<string, unknown> | undefined)?.entries || {}) as Record<string, unknown>);
  const leadtimeEntry =
    (entries.leadtime as Record<string, unknown> | undefined) ||
    (entries["@workcio/openclaw-leadtime-plugin"] as Record<string, unknown> | undefined);
  const pluginConfig = leadtimeEntry?.config as Record<string, unknown> | undefined;
  return parseConnectorConfig(pluginConfig);
}

function parseConnectorConfig(pluginConfig: Record<string, unknown> | undefined) {
  const config = pluginConfig || {};
  const bots = Array.isArray(config.bots) ? config.bots : [];
  return {
    webhookPath: normalizePath(readString(config.webhookPath, "/leadtime/webhook")),
    openClawGatewayBaseUrl: readString(config.openClawGatewayBaseUrl, "http://127.0.0.1:18789").replace(/\/+$/, ""),
    bots,
  };
}

function normalizePath(value: string): string {
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+$/, "") || "/leadtime/webhook";
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseArgs(values: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < values.length; index += 1) {
    const raw = values[index];
    if (!raw?.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function stringArg(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function printHelp() {
  console.log(`Leadtime OpenClaw connector

Usage:
  leadtime-openclaw-connector --config ~/.openclaw/openclaw.json --port 9339

The connector receives public Leadtime webhooks and forwards them to the local
OpenClaw plugin route. Expose this connector publicly; keep the OpenClaw gateway
itself private when possible.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
