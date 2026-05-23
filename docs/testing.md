# Testing

## Automated Checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

The unit tests cover config parsing, setup config generation, OpenAPI action discovery, and webhook signature validation.

## Manual Leadtime Matrix

Run these against a local Leadtime app and an existing OpenClaw gateway with the plugin installed.

| Case | Expected result |
| --- | --- |
| Basic mode task assignment | One Leadtime session is created, OpenClaw starts, agent adds a task comment, agent updates task status. |
| Basic mode repeated assignment | A new assignment creates a new Leadtime session/history card. |
| Basic mode task mention | Mentioning the bot in a task comment creates a session tied to that comment. |
| Full mode | Agent can use `leadtime_list_actions`, `leadtime_action_details`, and `leadtime_execute_action` to create/update safe Leadtime records. |
| Full mode without raw API | Bot PAT is not printed in activity, prompt, or task comments. |
| Full mode with raw API | Trusted agent can perform script-based batch API calls using the injected PAT and OpenAPI URL. |
| Invalid signature | Webhook is rejected before an OpenClaw run starts. |
| Retry/idempotency | Re-sending the same webhook event does not start duplicate OpenClaw runs. |
| Private gateway URL | Leadtime cannot deliver webhooks unless the gateway URL is reachable from Leadtime. |

## Development Harness

`examples/docker-compose.yml` exists only to test the plugin from a clean OpenClaw state without touching a personal gateway. It is not the recommended user deployment shape.

