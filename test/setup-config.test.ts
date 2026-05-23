import { describe, expect, it } from "vitest";
import {
  buildAgentInstallPrompt,
  buildOpenClawPluginConfig,
  buildWebhookUrl,
  mergeOpenClawConfig,
  normalizeLeadtimeApiBaseUrl,
} from "../src/setup-config.js";

describe("setup config helpers", () => {
  it("normalizes Leadtime base URLs", () => {
    expect(normalizeLeadtimeApiBaseUrl("https://leadtime.app")).toBe("https://leadtime.app/api");
    expect(normalizeLeadtimeApiBaseUrl("https://leadtime.app/api/public")).toBe("https://leadtime.app/api");
    expect(normalizeLeadtimeApiBaseUrl("https://leadtime.app/api/")).toBe("https://leadtime.app/api");
  });

  it("builds webhook URLs", () => {
    expect(buildWebhookUrl("https://agent.example.com/", "leadtime/webhook")).toBe(
      "https://agent.example.com/leadtime/webhook",
    );
  });

  it("builds safe basic config by default", () => {
    const config = buildOpenClawPluginConfig({
      leadtimeBaseUrl: "https://leadtime.app",
      bot: {
        botUserId: "bot-1",
        botPat: "pat",
        webhookSecret: "secret",
      },
    });

    expect(config).toMatchObject({
      leadtimeBaseUrl: "https://leadtime.app/api",
      webhookPath: "/leadtime/webhook",
      bots: [
        {
          botUserId: "bot-1",
          mode: "basic",
          exposeRawApiCredentialToAgent: false,
        },
      ],
    });
  });

  it("merges into existing OpenClaw config without removing unrelated config", () => {
    const merged = mergeOpenClawConfig(
      {
        gateway: { port: 19011 },
        plugins: { entries: { other: { enabled: true } } },
      },
      {
        leadtimeBaseUrl: "https://leadtime.app",
        gatewayPublicUrl: "https://agent.example.com",
        bot: {
          botUserId: "bot-1",
          botPat: "pat",
          webhookSecret: "secret",
          mode: "full",
          exposeRawApiCredentialToAgent: true,
        },
      },
    );

    expect(merged.gateway).toEqual({ port: 19011 });
    expect((merged.plugins as any).entries.other).toEqual({ enabled: true });
    expect((merged.agents as any).defaults.skipBootstrap).toBe(true);
    expect((merged.plugins as any).entries.leadtime.enabled).toBe(true);
    expect((merged.plugins as any).entries.leadtime.config.bots[0].mode).toBe("full");
  });

  it("builds copy-paste agent prompt", () => {
    const prompt = buildAgentInstallPrompt({
      leadtimeBaseUrl: "https://leadtime.app",
      gatewayPublicUrl: "https://agent.example.com",
      botUserId: "bot-1",
      mode: "basic",
    });

    expect(prompt).toContain("https://github.com/itspers/openclaw-leadtime-plugin");
    expect(prompt).toContain("Webhook URL to save in Leadtime: https://agent.example.com/leadtime/webhook");
    expect(prompt).toContain("Leadtime bot user id: bot-1");
  });
});
