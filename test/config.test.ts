import { describe, expect, it } from "vitest";
import { parsePluginConfig } from "../src/config.js";

describe("plugin config", () => {
  it("parses multiple bots", () => {
    const config = parsePluginConfig({
      leadtimeBaseUrl: "http://localhost:4205/api/",
      bots: [
        {
          botUserId: "bot-1",
          botPat: "pat-1",
          webhookSecret: "secret-1",
          mode: "full",
          agentId: "leadtime",
          exposeRawApiCredentialToAgent: true,
        },
        {
          botUserId: "bot-2",
          botPat: "pat-2",
          webhookSecret: "secret-2",
        },
      ],
    });

    expect(config.leadtimeBaseUrl).toBe("http://localhost:4205/api");
    expect(config.bots).toHaveLength(2);
    expect(config.bots[0]?.botPat).toBe("pat-1");
    expect(config.bots[0]?.mode).toBe("full");
    expect(config.bots[1]?.mode).toBe("basic");
  });
});
