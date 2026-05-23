import { describe, expect, it, vi } from "vitest";
import { signLeadtimeWebhook, verifyLeadtimeWebhookSignature } from "../src/signature.js";

describe("Leadtime webhook signatures", () => {
  it("verifies Leadtime HMAC signatures", () => {
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));
    const rawBody = JSON.stringify({ agentRunId: "run-1" });
    const timestamp = "2026-05-23T12:00:00.000Z";
    const signature = signLeadtimeWebhook({ rawBody, timestamp, secret: "secret" });

    expect(
      verifyLeadtimeWebhookSignature({
        rawBody,
        secret: "secret",
        headers: { signature, timestamp },
      }),
    ).toBe(true);
    expect(
      verifyLeadtimeWebhookSignature({
        rawBody,
        secret: "wrong",
        headers: { signature, timestamp },
      }),
    ).toBe(false);
    vi.useRealTimers();
  });
});
