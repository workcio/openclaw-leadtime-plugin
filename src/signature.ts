import { createHmac, timingSafeEqual } from "node:crypto";

export type LeadtimeSignatureHeaders = {
  signature?: string | string[];
  timestamp?: string | string[];
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function signLeadtimeWebhook(params: {
  rawBody: string;
  timestamp: string;
  secret: string;
}): string {
  const digest = createHmac("sha256", params.secret)
    .update(`${params.timestamp}.${params.rawBody}`)
    .digest("hex");
  return `t=${params.timestamp},v1=${digest}`;
}

export function verifyLeadtimeWebhookSignature(params: {
  rawBody: string;
  headers: LeadtimeSignatureHeaders;
  secret: string;
  toleranceSeconds?: number;
}): boolean {
  const signature = firstHeader(params.headers.signature);
  const timestamp = firstHeader(params.headers.timestamp);
  if (!signature || !timestamp) return false;

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const toleranceSeconds = params.toleranceSeconds ?? 300;
  if (Math.abs(Date.now() - timestampMs) > toleranceSeconds * 1000) return false;

  const expected = signLeadtimeWebhook({
    rawBody: params.rawBody,
    timestamp,
    secret: params.secret,
  });
  const expectedValue = expected.split("v1=")[1] ?? "";
  const actualValue = signature.split("v1=")[1] ?? "";
  if (!expectedValue || !actualValue) return false;

  const expectedBuffer = Buffer.from(expectedValue, "hex");
  const actualBuffer = Buffer.from(actualValue, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
