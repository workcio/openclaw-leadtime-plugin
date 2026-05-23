#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  buildAgentInstallPrompt,
  buildWebhookUrl,
  mergeOpenClawConfig,
  normalizeLeadtimeApiBaseUrl,
  normalizeWebhookPath,
  type SetupInput,
  type SetupMode,
} from "./setup-config.js";

type Args = Record<string, string | boolean>;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["help"]) {
    printHelp();
    return;
  }

  const configPath = stringArg(args, "config") || join(homedir(), ".openclaw", "openclaw.json");

  if (args["print-agent-prompt"]) {
    const prompt = buildAgentInstallPrompt({
      leadtimeBaseUrl: requiredArg(args, "leadtime-base-url"),
      webhookPath: stringArg(args, "webhook-path"),
      gatewayPublicUrl: stringArg(args, "gateway-public-url"),
      botUserId: requiredArg(args, "bot-user-id"),
      mode: modeArg(args),
      exposeRawApiCredentialToAgent: boolArg(args, "raw-api"),
    });
    console.log(prompt);
    return;
  }

  const setup = await collectSetup(args);
  const existing = readJsonFile(configPath);
  const merged = mergeOpenClawConfig(existing, setup);

  if (args["dry-run"]) {
    console.log(JSON.stringify(redactSecrets(merged), null, 2));
  } else {
    await mkdir(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  }

  const webhookUrl = setup.gatewayPublicUrl
    ? buildWebhookUrl(setup.gatewayPublicUrl, setup.webhookPath)
    : "<your-openclaw-public-url>/leadtime/webhook";

  console.log("");
  console.log(args["dry-run"] ? "Dry run complete." : `Updated ${configPath}.`);
  console.log("");
  console.log("Next steps:");
  console.log("1. Install/enable the plugin if it is not installed yet:");
  console.log("   openclaw plugins install git:github.com/itspers/openclaw-leadtime-plugin@main");
  console.log("   openclaw plugins enable leadtime");
  console.log("2. Restart the OpenClaw gateway.");
  console.log(`3. In Leadtime, set this bot webhook URL to: ${webhookUrl}`);
  console.log("4. Assign a test task to the bot and confirm the Leadtime session card updates.");
}

async function collectSetup(args: Args): Promise<SetupInput> {
  const rl = createInterface({ input, output });
  try {
    const leadtimeBaseUrl = normalizeLeadtimeApiBaseUrl(
      await ask(rl, args, "leadtime-base-url", "Leadtime app/API URL", "https://leadtime.app"),
    );
    const gatewayPublicUrl = await askOptional(
      rl,
      args,
      "gateway-public-url",
      "Public OpenClaw gateway URL reachable by Leadtime",
    );
    const webhookPath = normalizeWebhookPath(
      await ask(rl, args, "webhook-path", "Plugin webhook path", "/leadtime/webhook"),
    );
    const botUserId = await ask(rl, args, "bot-user-id", "Leadtime bot user id");
    const botPat = await askSecret(rl, args, "bot-pat", "Leadtime bot PAT");
    const webhookSecret = await askSecret(rl, args, "webhook-secret", "Leadtime webhook signing secret");
    const agentId = await ask(rl, args, "agent-id", "OpenClaw agent id", "main");
    const mode = modeArg(args) ?? ((await ask(rl, args, "mode", "Mode: basic or full", "basic")) === "full" ? "full" : "basic");
    const exposeRawApiCredentialToAgent =
      boolArg(args, "raw-api") ??
      (await ask(rl, args, "raw-api", "Expose raw Leadtime API credential to agent? yes/no", "no")).toLowerCase().startsWith("y");
    const promptGuidance = await askOptional(rl, args, "prompt-guidance", "Optional bot-specific guidance");

    return {
      leadtimeBaseUrl,
      webhookPath,
      gatewayPublicUrl,
      skipBootstrap: true,
      bot: {
        name: await ask(rl, args, "name", "Connection name", "Leadtime Bot"),
        botUserId,
        botPat,
        webhookSecret,
        agentId,
        mode,
        promptGuidance,
        exposeRawApiCredentialToAgent,
      },
    };
  } finally {
    rl.close();
  }
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  args: Args,
  key: string,
  label: string,
  fallback = "",
): Promise<string> {
  const fromArgs = stringArg(args, key);
  if (fromArgs) return fromArgs;
  if (!input.isTTY) return fallback;
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function askOptional(
  rl: ReturnType<typeof createInterface>,
  args: Args,
  key: string,
  label: string,
): Promise<string | undefined> {
  const value = await ask(rl, args, key, label);
  return value || undefined;
}

async function askSecret(
  rl: ReturnType<typeof createInterface>,
  args: Args,
  key: string,
  label: string,
): Promise<string> {
  const value = await ask(rl, args, key, label);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSecretLikeKey(key) ? "<redacted>" : redactSecrets(entry);
  }
  return result;
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized === "botpat" ||
    normalized.endsWith("pat") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey")
  );
}

function parseArgs(values: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < values.length; index += 1) {
    const raw = values[index];
    if (!raw?.startsWith("--")) continue;
    const withoutPrefix = raw.slice(2);
    const inlineEquals = withoutPrefix.indexOf("=");
    if (inlineEquals !== -1) {
      args[withoutPrefix.slice(0, inlineEquals)] = withoutPrefix.slice(inlineEquals + 1);
      continue;
    }
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      args[withoutPrefix] = next;
      index += 1;
    } else {
      args[withoutPrefix] = true;
    }
  }
  return args;
}

function stringArg(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredArg(args: Args, key: string): string {
  const value = stringArg(args, key);
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}

function boolArg(args: Args, key: string): boolean | undefined {
  if (args[key] === true) return true;
  const value = stringArg(args, key)?.toLowerCase();
  if (!value) return undefined;
  return ["1", "true", "yes", "y"].includes(value);
}

function modeArg(args: Args): SetupMode | undefined {
  const mode = stringArg(args, "mode");
  if (!mode) return undefined;
  return mode === "full" ? "full" : "basic";
}

function printHelp() {
  console.log(`Leadtime OpenClaw setup

Usage:
  leadtime-openclaw setup
  leadtime-openclaw --leadtime-base-url https://leadtime.app --gateway-public-url https://agent.example.com --bot-user-id <id> --bot-pat <pat> --webhook-secret <secret>
  leadtime-openclaw --print-agent-prompt --leadtime-base-url https://leadtime.app --bot-user-id <id>

Options:
  --config <path>                OpenClaw config path. Defaults to ~/.openclaw/openclaw.json
  --leadtime-base-url <url>      Leadtime app URL or API URL
  --gateway-public-url <url>     Public OpenClaw gateway URL reachable by Leadtime
  --webhook-path <path>          Plugin route. Defaults to /leadtime/webhook
  --bot-user-id <id>             Leadtime bot user id
  --bot-pat <token>              Leadtime bot PAT
  --webhook-secret <secret>      Leadtime webhook signing secret
  --agent-id <id>                OpenClaw agent id. Defaults to main
  --mode <basic|full>            Tool mode. Defaults to basic
  --raw-api <yes|no>             Expose raw Leadtime API credential to the agent
  --dry-run                      Print merged config without writing
  --print-agent-prompt           Print copy-paste prompt for a coding agent
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
