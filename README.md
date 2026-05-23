# OpenClaw Leadtime Plugin

Connects Leadtime self-hosted agent sessions to OpenClaw agents.

Leadtime calls this plugin through the bot webhook. The plugin verifies the Leadtime HMAC signature, binds the Leadtime `agentRunId` to one OpenClaw agent session, dispatches the configured OpenClaw agent, and reports status/activity back to Leadtime through the public agent-session API.

## Install

```bash
openclaw plugins install git:github.com/workcio/openclaw-leadtime-plugin@main
openclaw plugins enable leadtime
```

Then generate a one-time setup code in Leadtime bot settings and run the setup wizard on the same machine as your OpenClaw gateway:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin setup \
  --leadtime-base-url https://leadtime.app \
  --claim lt_conn_...
```

The wizard runs on the OpenClaw machine, so it resolves the gateway public URL from existing config or environment. If it detects a private/local URL for Leadtime Cloud, it stops before claiming the setup code and explains how to expose OpenClaw safely.

For local development:

```bash
openclaw plugins install --link /path/to/openclaw-leadtime-plugin
```

## Leadtime Setup

1. In Leadtime, create or open a self-hosted bot.
2. Open the OpenClaw setup helper and generate a one-time setup code.
3. Run the generated command on the OpenClaw machine.

Claiming the setup code enables webhooks/sessions in Leadtime, creates a fresh bot PAT, stores the webhook URL, and writes the returned one-time secrets into OpenClaw config.

For step-by-step setup, existing VPS/local gateway notes, and agent-assisted install prompts, see [docs/setup.md](docs/setup.md).

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

See [examples/docker-compose.yml](examples/docker-compose.yml). This is a development smoke-test harness for the plugin repo, not the recommended user deployment model. Normal users install the plugin into their existing local, workstation, or VPS OpenClaw gateway.

For headless/plugin-only gateways, initialize OpenClaw first or set `agents.defaults.skipBootstrap: true` in `openclaw.json`. A brand-new OpenClaw workspace may otherwise inject first-run bootstrap guidance into the first Leadtime task session.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
