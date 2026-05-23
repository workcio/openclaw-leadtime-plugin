# Setup

Use this plugin with an existing OpenClaw gateway on your laptop, workstation, or VPS. Docker is only a development smoke-test harness for this repository.

## What You Need

- A Leadtime self-hosted bot.
- A Leadtime bot PAT with `api:read` and `api:write`.
- The bot webhook signing secret from Leadtime.
- An OpenClaw gateway URL that Leadtime can reach.
- The OpenClaw agent id to run, usually `main`.

If your OpenClaw gateway is only available on a private network such as Tailscale, Leadtime Cloud cannot call it unless Leadtime is also inside that network. Use a public HTTPS reverse proxy, tunnel, or a publicly reachable VPS URL for the webhook endpoint.

## Fast Path

Install the plugin into OpenClaw:

```bash
openclaw plugins install @itspers/openclaw-leadtime-plugin
openclaw plugins enable leadtime
```

Run the setup wizard:

```bash
npx @itspers/openclaw-leadtime-plugin setup
```

The wizard patches `~/.openclaw/openclaw.json`, enables the plugin, sets `agents.defaults.skipBootstrap=true` for clean headless task sessions, and prints the webhook URL you should save in Leadtime.

Restart your OpenClaw gateway after the wizard.

## Non-Interactive Setup

```bash
npx @itspers/openclaw-leadtime-plugin setup \
  --leadtime-base-url https://leadtime.app \
  --gateway-public-url https://openclaw.example.com \
  --bot-user-id leadtime-bot-user-id \
  --bot-pat "$LEADTIME_BOT_PAT" \
  --webhook-secret "$LEADTIME_WEBHOOK_SECRET" \
  --agent-id main \
  --mode basic
```

Save this webhook URL in Leadtime:

```text
https://openclaw.example.com/leadtime/webhook
```

## Agent-Assisted Setup

If you prefer to let a coding agent configure your existing OpenClaw installation, generate a prompt:

```bash
npx @itspers/openclaw-leadtime-plugin --print-agent-prompt \
  --leadtime-base-url https://leadtime.app \
  --gateway-public-url https://openclaw.example.com \
  --bot-user-id leadtime-bot-user-id
```

Paste the generated prompt into Codex, OpenClaw, Claude Code, Cursor, or another coding agent that has access to your OpenClaw machine. Give it the bot PAT and webhook signing secret only when you trust that agent and environment.

## Manual Config

The wizard writes this shape under `plugins.entries.leadtime.config`:

```json
{
  "agents": {
    "defaults": {
      "skipBootstrap": true
    }
  },
  "plugins": {
    "entries": {
      "leadtime": {
        "enabled": true,
        "config": {
          "leadtimeBaseUrl": "https://leadtime.app/api",
          "webhookPath": "/leadtime/webhook",
          "runner": {
            "timeoutSeconds": 900,
            "thinking": "minimal"
          },
          "bots": [
            {
              "name": "Leadtime Bot",
              "botUserId": "leadtime-bot-user-id",
              "botPat": "${LEADTIME_BOT_PAT}",
              "webhookSecret": "${LEADTIME_WEBHOOK_SECRET}",
              "agentId": "main",
              "mode": "basic",
              "exposeRawApiCredentialToAgent": false
            }
          ]
        }
      }
    }
  }
}
```

## Modes

Use `basic` first. It exposes task/session tools only: read context/task, write task comments, list statuses, and update task status.

Use `full` when the agent should access the generic Leadtime public API tool wrapper.

Use `exposeRawApiCredentialToAgent=true` only for trusted agents. It gives the agent direct access to the bot PAT for script-based bulk API calls.

