# OpenClaw Leadtime Plugin

Connects Leadtime self-hosted agent sessions to OpenClaw agents.

Leadtime calls this plugin through the bot webhook. The plugin verifies the Leadtime HMAC signature, binds the Leadtime `agentRunId` to one OpenClaw agent session, dispatches the configured OpenClaw agent, and reports status/activity back to Leadtime through the public agent-session API.

## Install

```bash
openclaw plugins install @itspers/openclaw-leadtime-plugin
openclaw plugins enable leadtime
```

For local development:

```bash
openclaw plugins install --link /path/to/openclaw-leadtime-plugin
```

## Leadtime Setup

1. In Leadtime, create or open a self-hosted bot.
2. Create a bot Personal Access Token with read/write API access.
3. Enable the bot self-hosted agent connection.
4. Set the webhook URL to your OpenClaw gateway route, for example `https://openclaw.example.com/leadtime/webhook`.
5. Generate/copy the Leadtime webhook signing secret.
6. Add the bot to this plugin config.

## Configuration

```json
{
  "plugins": {
    "entries": {
      "leadtime": {
        "enabled": true,
        "config": {
          "leadtimeBaseUrl": "https://app.leadtime.de/api",
          "webhookPath": "/leadtime/webhook",
          "runner": {
            "timeoutSeconds": 900,
            "thinking": "medium"
          },
          "bots": [
            {
              "name": "OpenClaw Helper",
              "botUserId": "leadtime-bot-user-id",
              "botPat": { "source": "env", "provider": "default", "id": "LEADTIME_BOT_PAT" },
              "webhookSecret": { "source": "env", "provider": "default", "id": "LEADTIME_WEBHOOK_SECRET" },
              "agentId": "main",
              "mode": "basic"
            }
          ]
        }
      }
    }
  }
}
```

`botPat` and `webhookSecret` also accept `"${ENV_VAR}"`.

## Modes

`basic` mode exposes controlled task tools:

- `leadtime_get_session_context`
- `leadtime_read_task`
- `leadtime_add_task_comment`
- `leadtime_list_task_statuses`
- `leadtime_update_task_status`

`full` mode also exposes generic public API tools:

- `leadtime_list_actions`
- `leadtime_action_details`
- `leadtime_execute_action`

Set `exposeRawApiCredentialToAgent: true` only for trusted agents. It puts the bot PAT and OpenAPI URL into the prompt so the agent can write scripts that call Leadtime directly.

## Docker

See [examples/docker-compose.yml](examples/docker-compose.yml). Mount `~/.codex` and `~/.openclaw` if your OpenClaw agent uses the local Codex auth profile. For OAuth-based model providers, prefer a copied writable OpenClaw state directory per container so the host and container do not race on the same refresh token.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
