#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import {
  detectGatewayPublicUrl,
  validateGatewayPublicUrlForLeadtime,
} from "./gateway-url.js";
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
      gatewayPublicUrl: connectorPublicUrlArg(args),
      botUserId: requiredArg(args, "bot-user-id"),
      mode: modeArg(args),
      exposeRawApiCredentialToAgent: boolArg(args, "raw-api"),
    });
    console.log(prompt);
    return;
  }

  const existing = readJsonFile(configPath);
  const setup = await collectSetup(args, existing);
  const merged = mergeOpenClawConfig(existing, setup);
  let runtimePackagePath: string | undefined;

  if (args["dry-run"]) {
    console.log(JSON.stringify(redactSecrets(merged), null, 2));
  } else {
    await mkdir(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);
    runtimePackagePath = writeRuntimePackage(dirname(configPath));
  }

  const webhookUrl = setup.gatewayPublicUrl
    ? buildWebhookUrl(setup.gatewayPublicUrl, setup.webhookPath)
    : "<your-connector-public-url>/leadtime/webhook";

  console.log("");
  console.log(args["dry-run"] ? "Dry run complete." : `Updated ${configPath}.`);
  if (runtimePackagePath) {
    console.log(`Prepared OpenClaw plugin runtime at ${runtimePackagePath}.`);
  }
  console.log("");
  console.log("Next steps:");
  console.log("1. Install/enable the plugin if it is not installed yet:");
  console.log(`   openclaw plugins install --link ${runtimePackagePath || "<prepared-runtime-path>"}`);
  console.log("   openclaw plugins enable leadtime");
  console.log("2. Restart the OpenClaw gateway.");
  console.log("3. The Leadtime connector listener starts with the OpenClaw gateway.");
  if (args["claim"]) {
    console.log(`4. Leadtime has saved this bot webhook URL: ${webhookUrl}`);
  } else {
    console.log(`4. In Leadtime, set this bot webhook URL to: ${webhookUrl}`);
  }
  console.log("5. Assign a test task to the bot and confirm the Leadtime session card updates.");
}

async function collectSetup(args: Args, existingConfig: Record<string, unknown>): Promise<SetupInput> {
  const rl = createInterface({ input, output });
  try {
    const leadtimeBaseUrl = normalizeLeadtimeApiBaseUrl(
      await ask(rl, args, "leadtime-base-url", "Leadtime app/API URL", "https://leadtime.app"),
    );
    const claimToken = stringArg(args, "claim");
    if (claimToken) {
      if (args["dry-run"]) {
        throw new Error("--dry-run cannot be used with --claim because claiming enables the Leadtime bot connection.");
      }
      const gatewayPublicUrl = await resolveConnectorPublicUrl(rl, args, existingConfig, leadtimeBaseUrl);
      return claimSetupToken({
        leadtimeBaseUrl,
        setupToken: claimToken,
        gatewayPublicUrl,
        openClawGatewayBaseUrl: stringArg(args, "openclaw-gateway-url") || "http://127.0.0.1:18789",
        agentId: stringArg(args, "agent-id") || "main",
      });
    }
    const detected = detectGatewayPublicUrl(existingConfig);
    const gatewayPublicUrl = await askOptional(
      rl,
      args,
      "connector-public-url",
      detected
        ? `Public connector URL reachable by Leadtime (${detected.source})`
        : "Public connector URL reachable by Leadtime",
      detected?.url,
    );
    if (gatewayPublicUrl) validateGatewayOrThrow(gatewayPublicUrl, leadtimeBaseUrl);
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
      openClawGatewayBaseUrl: stringArg(args, "openclaw-gateway-url") || "http://127.0.0.1:18789",
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

async function resolveConnectorPublicUrl(
  rl: ReturnType<typeof createInterface>,
  args: Args,
  existingConfig: Record<string, unknown>,
  leadtimeBaseUrl: string,
): Promise<string> {
  const detected = detectGatewayPublicUrl(existingConfig);
  const value = await askOptional(
    rl,
    args,
    "connector-public-url",
    detected
      ? `Public connector URL reachable by Leadtime (${detected.source})`
      : "Public connector URL reachable by Leadtime",
    detected?.url,
  );
  if (value) {
    validateGatewayOrThrow(value, leadtimeBaseUrl);
    return value;
  }
  throw new Error(
    [
      "Could not determine the public connector URL.",
      "Leadtime uses webhooks, so it must be able to reach the Leadtime OpenClaw connector over public HTTPS.",
      "Run setup in an interactive terminal, set LEADTIME_OPENCLAW_CONNECTOR_PUBLIC_URL, or pass --connector-public-url.",
      "",
      ...gatewaySetupHelp(),
    ].join("\n"),
  );
}

function validateGatewayOrThrow(gatewayPublicUrl: string, leadtimeBaseUrl: string) {
  const validation = validateGatewayPublicUrlForLeadtime(gatewayPublicUrl, leadtimeBaseUrl);
  if (validation.ok) return;
  throw new Error([
    validation.reason || "Connector URL is not usable for Leadtime webhooks.",
    "",
    ...(validation.help || gatewaySetupHelp()),
  ].join("\n"));
}

function gatewaySetupHelp(): string[] {
  return [
    "Options:",
    "- Tailscale Funnel: expose the connector port, for example `tailscale funnel 9339` on the OpenClaw machine.",
    "- Cloudflare Tunnel: create a named tunnel to `http://127.0.0.1:9339`, then set LEADTIME_OPENCLAW_CONNECTOR_PUBLIC_URL to that HTTPS hostname.",
    "- Reverse proxy: expose `http://127.0.0.1:9339` through nginx/Caddy/Traefik with HTTPS.",
    "- Quick Cloudflare tunnels are useful for testing, but not a good permanent bot webhook URL because they are account-less and not guaranteed stable.",
  ];
}

async function claimSetupToken(params: {
  leadtimeBaseUrl: string;
  setupToken: string;
  gatewayPublicUrl: string;
  openClawGatewayBaseUrl: string;
  agentId: string;
}): Promise<SetupInput> {
  const endpoint = `${normalizeLeadtimeApiBaseUrl(params.leadtimeBaseUrl)}/public/agent-connectors/setup/claim`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      setupToken: params.setupToken,
      gatewayPublicUrl: params.gatewayPublicUrl,
      agentId: params.agentId,
      runtimeVersion: "openclaw-leadtime-plugin",
    }),
  });

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body["message"] === "string" ? body["message"] : `Setup claim failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    leadtimeBaseUrl: params.leadtimeBaseUrl,
    webhookPath: String(body["webhookPath"] || "/leadtime/webhook"),
    gatewayPublicUrl: params.gatewayPublicUrl,
    openClawGatewayBaseUrl: params.openClawGatewayBaseUrl,
    skipBootstrap: true,
    bot: {
      name: String(body["botName"] || "Leadtime Bot"),
      botUserId: requiredString(body, "botUserId"),
      botPat: requiredString(body, "botPat"),
      webhookSecret: requiredString(body, "webhookSecret"),
      agentId: String(body["agentId"] || params.agentId || "main"),
      mode: body["mode"] === "full" ? "full" : "basic",
      promptGuidance: typeof body["guidance"] === "object" && body["guidance"] && typeof (body["guidance"] as Record<string, unknown>)["instructions"] === "string"
        ? String((body["guidance"] as Record<string, unknown>)["instructions"])
        : undefined,
      exposeRawApiCredentialToAgent: body["exposeRawApiCredentialToAgent"] === true,
    },
  };
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Setup claim response is missing ${key}.`);
  }
  return value.trim();
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
  fallback = "",
): Promise<string | undefined> {
  const value = await ask(rl, args, key, label, fallback);
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

function writeRuntimePackage(openClawConfigDir: string): string {
  const packageRoot = findPackageRoot();
  const runtimeDir = join(openClawConfigDir, "plugins", "leadtime-runtime");
  const distDir = join(packageRoot, "dist");

  if (!existsSync(join(distDir, "index.js"))) {
    throw new Error("The Leadtime OpenClaw plugin runtime is missing. Run npm run build before setup.");
  }

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(join(runtimeDir, "dist"), { recursive: true });

  copyIfExists(join(distDir, "index.js"), join(runtimeDir, "dist", "index.js"));
  copyIfExists(join(distDir, "index.d.ts"), join(runtimeDir, "dist", "index.d.ts"));
  for (const entry of readdirSync(distDir)) {
    if (entry.startsWith("chunk-") && entry.endsWith(".js")) {
      copyIfExists(join(distDir, entry), join(runtimeDir, "dist", entry));
    }
  }
  copyIfExists(join(packageRoot, "openclaw.plugin.json"), join(runtimeDir, "openclaw.plugin.json"));
  copyIfExists(join(packageRoot, "README.md"), join(runtimeDir, "README.md"));
  copyIfExists(join(packageRoot, "docs"), join(runtimeDir, "docs"));
  writeFileSync(
    join(runtimeDir, "package.json"),
    JSON.stringify(
      {
        name: "@workcio/openclaw-leadtime-plugin-runtime",
        version: "0.1.0",
        type: "module",
        main: "./dist/index.js",
        openclaw: { extensions: ["./dist/index.js"] },
        peerDependencies: { openclaw: ">=2026.4.0" },
      },
      null,
      2,
    ) + "\n",
  );
  return runtimeDir;
}

function findPackageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (current !== dirname(current)) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "openclaw.plugin.json"))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error("Could not locate the Leadtime OpenClaw plugin package root.");
}

function copyIfExists(source: string, target: string) {
  if (!existsSync(source)) return;
  cpSync(source, target, { recursive: true });
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
  if (args["gateway-public-url"] && !args["connector-public-url"]) {
    args["connector-public-url"] = args["gateway-public-url"];
  }
  return args;
}

function stringArg(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function connectorPublicUrlArg(args: Args): string | undefined {
  return stringArg(args, "connector-public-url") || stringArg(args, "gateway-public-url");
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
  leadtime-openclaw --leadtime-base-url https://leadtime.app --claim <setup-code>
  leadtime-openclaw --leadtime-base-url https://leadtime.app --connector-public-url https://agent.example.com --bot-user-id <id> --bot-pat <pat> --webhook-secret <secret>
  leadtime-openclaw --print-agent-prompt --leadtime-base-url https://leadtime.app --bot-user-id <id>

Options:
  --config <path>                OpenClaw config path. Defaults to ~/.openclaw/openclaw.json
  --leadtime-base-url <url>      Leadtime app URL or API URL
  --connector-public-url <url>   Public Leadtime connector URL reachable by Leadtime. Optional with --claim when it can be detected or entered interactively
  --gateway-public-url <url>     Backward-compatible alias for --connector-public-url
  --openclaw-gateway-url <url>   Local OpenClaw gateway URL for the connector. Defaults to http://127.0.0.1:18789
  --claim <token>                One-time Leadtime connector setup token
  --webhook-path <path>          Plugin route. Defaults to /leadtime/webhook
  --bot-user-id <id>             Leadtime bot user id
  --bot-pat <token>              Leadtime bot PAT
  --webhook-secret <secret>      Leadtime webhook signing secret
  --agent-id <id>                OpenClaw agent id. Defaults to main
  --mode <basic|full>            Tool mode. Defaults to basic
  --raw-api <yes|no>             Expose raw Leadtime API credential to the agent
  --dry-run                      Print merged config without writing
  --print-agent-prompt           Print copy-paste prompt for a coding agent

Setup writes a runtime-only plugin package under ~/.openclaw/plugins/leadtime-runtime.
Install that generated runtime with openclaw plugins install --link; do not install the setup CLI package itself as an OpenClaw plugin.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
