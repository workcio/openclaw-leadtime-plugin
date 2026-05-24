export type GatewayUrlCandidate = {
  url: string;
  source: string;
};

export type GatewayUrlValidation = {
  ok: boolean;
  reason?: string;
  help?: string[];
};

const URL_KEY_PATTERNS = [
  /gatewayPublicUrl/i,
  /publicBaseUrl/i,
  /publicUrl/i,
  /externalUrl/i,
  /webhookBaseUrl/i,
  /baseUrl/i,
  /appUrl/i,
  /redirectUri/i,
  /callbackUrl/i,
];

export function detectGatewayPublicUrl(existingConfig: Record<string, unknown>): GatewayUrlCandidate | undefined {
  const envCandidate = detectGatewayPublicUrlFromEnv();
  if (envCandidate) return envCandidate;

  const leadtimeConfig = objectAtPath(existingConfig, ["plugins", "entries", "leadtime", "config"]);
  if (leadtimeConfig) {
    const value = readString(leadtimeConfig["gatewayPublicUrl"]);
    if (value) return { url: value, source: "existing Leadtime plugin config" };
  }

  return findUrlCandidate(existingConfig);
}

export function validateGatewayPublicUrlForLeadtime(
  gatewayPublicUrl: string,
  leadtimeBaseUrl: string,
): GatewayUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(gatewayPublicUrl);
  } catch {
    return {
      ok: false,
      reason: `Connector URL is not a valid URL: ${gatewayPublicUrl}`,
      help: publicUrlHelp(),
    };
  }

  const leadtimeIsLocal = isLocalLeadtime(leadtimeBaseUrl);
  const hostname = parsed.hostname.toLowerCase();

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `Connector URL must use HTTPS for Leadtime SaaS webhooks: ${gatewayPublicUrl}`,
      help: publicUrlHelp(),
    };
  }

  if (isLocalHostname(hostname)) {
    if (leadtimeIsLocal) return { ok: true };
    return {
      ok: false,
      reason: `Connector URL ${gatewayPublicUrl} points to localhost. Leadtime SaaS cannot call a user's local machine.`,
      help: publicUrlHelp(),
    };
  }

  if (isPrivateHostname(hostname)) {
    if (leadtimeIsLocal) return { ok: true };
    return {
      ok: false,
      reason: `Connector URL ${gatewayPublicUrl} is private or tailnet-only. Leadtime SaaS cannot deliver webhooks to it.`,
      help: publicUrlHelp(),
    };
  }

  if (!leadtimeIsLocal && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `Connector URL must use HTTPS for Leadtime SaaS webhooks: ${gatewayPublicUrl}`,
      help: publicUrlHelp(),
    };
  }

  return { ok: true };
}

function detectGatewayPublicUrlFromEnv(): GatewayUrlCandidate | undefined {
  const envKeys = [
    "LEADTIME_OPENCLAW_CONNECTOR_PUBLIC_URL",
    "LEADTIME_OPENCLAW_GATEWAY_PUBLIC_URL",
    "OPENCLAW_LEADTIME_CONNECTOR_PUBLIC_URL",
    "OPENCLAW_GATEWAY_PUBLIC_URL",
    "OPENCLAW_PUBLIC_URL",
    "PUBLIC_URL",
  ];
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value) return { url: value, source: `$${key}` };
  }
  return undefined;
}

function findUrlCandidate(value: unknown, path: string[] = []): GatewayUrlCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findUrlCandidate(value[index], [...path, String(index)]);
      if (nested) return nested;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => scoreUrlKey(b) - scoreUrlKey(a));
  for (const key of keys) {
    const entry = record[key];
    if (typeof entry === "string" && scoreUrlKey(key) > 0) {
      const url = originFromUrl(entry);
      if (url) return { url, source: [...path, key].join(".") };
    }
  }

  for (const key of keys) {
    const nested = findUrlCandidate(record[key], [...path, key]);
    if (nested) return nested;
  }

  return undefined;
}

function scoreUrlKey(key: string): number {
  const index = URL_KEY_PATTERNS.findIndex((pattern) => pattern.test(key));
  if (index === -1) return 0;
  return URL_KEY_PATTERNS.length - index;
}

function originFromUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function objectAtPath(value: Record<string, unknown>, path: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isLocalLeadtime(leadtimeBaseUrl: string): boolean {
  try {
    return isLocalHostname(new URL(leadtimeBaseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "host.docker.internal"
  );
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) return true;
  if (hostname.endsWith(".ts.net")) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;

  const [a = 0, b = 0] = hostname.split(".").map((part) => Number(part));
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254)
  );
}

function publicUrlHelp(): string[] {
  return [
    "Expose the Leadtime connector through a public HTTPS URL, then rerun setup.",
    "Good options: Tailscale Funnel, Cloudflare Tunnel, nginx/Caddy reverse proxy, or an existing public OpenClaw domain.",
    "For private Tailscale/lan addresses, Serve is not enough for Leadtime SaaS; use Funnel or another public HTTPS tunnel.",
    "If you already have a public connector URL, pass --connector-public-url https://your-agent.example.com.",
  ];
}
