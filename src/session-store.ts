import type { LeadtimeBotConfig } from "./config.js";

export type SessionBinding = {
  runId: string;
  bot: LeadtimeBotConfig;
  taskId?: string;
  taskIdentifier?: string;
  receivedAt: number;
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionBinding>();

  set(binding: SessionBinding): void {
    this.sessions.set(binding.runId, binding);
  }

  get(runId: string): SessionBinding | undefined {
    return this.sessions.get(runId);
  }
}
