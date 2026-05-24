import { describe, expect, it } from "vitest";
import {
  detectGatewayPublicUrl,
  validateGatewayPublicUrlForLeadtime,
} from "../src/gateway-url.js";

describe("gateway URL discovery", () => {
  it("prefers existing Leadtime plugin gateway URL", () => {
    const detected = detectGatewayPublicUrl({
      plugins: {
        entries: {
          leadtime: {
            config: {
              gatewayPublicUrl: "https://openclaw.example.com",
            },
          },
        },
      },
    });

    expect(detected).toEqual({
      url: "https://openclaw.example.com",
      source: "existing Leadtime plugin config",
    });
  });

  it("finds generic public URL fields without depending on a specific plugin", () => {
    const detected = detectGatewayPublicUrl({
      plugins: {
        entries: {
          someWebhookPlugin: {
            config: {
              publicBaseUrl: "https://openclaw.stasno.de/some/path",
            },
          },
        },
      },
    });

    expect(detected).toEqual({
      url: "https://openclaw.stasno.de",
      source: "plugins.entries.someWebhookPlugin.config.publicBaseUrl",
    });
  });

  it("accepts localhost only for local Leadtime", () => {
    expect(validateGatewayPublicUrlForLeadtime("http://localhost:18789", "http://localhost:9220/api").ok).toBe(true);
    expect(validateGatewayPublicUrlForLeadtime("http://localhost:18789", "http://host.docker.internal:9221/api").ok).toBe(true);
    expect(validateGatewayPublicUrlForLeadtime("http://localhost:18789", "https://leadtime.app/api").ok).toBe(false);
  });

  it("rejects private and tailnet-only URLs for Leadtime SaaS", () => {
    expect(validateGatewayPublicUrlForLeadtime("http://100.81.173.20:18789", "https://leadtime.app/api").ok).toBe(false);
    expect(validateGatewayPublicUrlForLeadtime("https://host.tailnet.ts.net", "https://leadtime.app/api").ok).toBe(false);
    expect(validateGatewayPublicUrlForLeadtime("https://openclaw.example.com", "https://leadtime.app/api").ok).toBe(true);
  });
});
