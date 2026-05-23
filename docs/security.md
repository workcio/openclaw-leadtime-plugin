# Security Notes

Leadtime bot PATs authorize API calls. Webhook secrets authenticate inbound Leadtime webhook deliveries.

The plugin validates `Leadtime-Signature` against the exact raw request body using the Leadtime format:

```text
t=<iso timestamp>,v1=<hmac-sha256(timestamp + "." + rawBody)>
```

Inbound webhook ids are deduplicated in memory. Leadtime also retries failed deliveries with backoff, so the handler returns `202` as soon as the request is accepted and runs the OpenClaw agent asynchronously.

Only the bot that owns a Leadtime session should update that session. Leadtime enforces this on the public session API by checking the bot PAT against the `agentRun.actorBotUserId`.

Avoid `exposeRawApiCredentialToAgent` unless the OpenClaw agent is fully trusted. Basic mode is the safer default because the agent can only read the session/task, write comments, and update task status through scoped tools.
