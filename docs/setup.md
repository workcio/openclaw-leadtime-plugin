# Setup

Use this plugin with an existing OpenClaw gateway on your laptop, workstation, or VPS. Docker is only a development smoke-test harness for this repository.

## What You Need

- A Leadtime self-hosted bot.
- A one-time setup code from the bot's OpenClaw setup helper.
- A Leadtime connector public URL that Leadtime can reach.
- The OpenClaw agent id to run, usually `main`.

If OpenClaw is only available on a private network such as Tailscale, keep it private. Expose the small `leadtime-openclaw-connector` process instead. Leadtime Cloud must be able to call the connector webhook URL over public HTTPS.

## Fast Path

Install the plugin into OpenClaw:

```bash
openclaw plugins install git:github.com/workcio/openclaw-leadtime-plugin@main
openclaw plugins enable leadtime
```

Generate a setup code in Leadtime, then run the setup wizard:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin setup \
  --leadtime-base-url https://leadtime.app \
  --claim lt_conn_... \
  --agent-id main
```

Claiming the setup code enables webhooks/sessions in Leadtime, creates a fresh bot PAT, stores the connector webhook URL, patches `~/.openclaw/openclaw.json`, enables the plugin, and sets `agents.defaults.skipBootstrap=true` for clean headless task sessions. The wizard resolves the connector public URL on the OpenClaw machine from existing config or environment. If it detects a local/private URL for Leadtime Cloud, it stops before claiming the setup code and prints setup options.

Restart your OpenClaw gateway after the wizard, then start the connector:

```bash
leadtime-openclaw-connector
```

You can run the wizard again later to connect another Leadtime bot to another OpenClaw agent. Existing Leadtime bot entries are preserved. If you run it again with the same Leadtime bot user id, that bot entry is updated.

## Non-Interactive Setup

Preferred setup uses a one-time claim code:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin setup \
  --leadtime-base-url https://leadtime.app \
  --claim "$LEADTIME_OPENCLAW_SETUP_CODE" \
  --agent-id main \
  --mode basic
```

For fully headless installs, provide `LEADTIME_OPENCLAW_CONNECTOR_PUBLIC_URL=https://agent.example.com` or pass `--connector-public-url`. Interactive installs do not need it in the generated Leadtime command.

## Private Networks

Leadtime webhooks require Leadtime to call your connector. A local URL, LAN address, or Tailscale-only Serve URL is not enough for Leadtime Cloud.

Recommended options:

- Tailscale Funnel: expose the connector port, for example `tailscale funnel 9339`.
- Named Cloudflare Tunnel: stable and suitable for production when mapped to your own hostname.
- Reverse proxy: expose `http://127.0.0.1:9339` through nginx, Caddy, Traefik, or a similar HTTPS proxy.

Cloudflare Quick Tunnels are useful for temporary testing, but they are not a permanent bot webhook URL because account-less quick tunnel hostnames are not guaranteed stable.

Manual setup is still available for custom wrappers or advanced debugging:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin setup \
  --leadtime-base-url https://leadtime.app \
  --connector-public-url https://agent.example.com \
  --bot-user-id leadtime-bot-user-id \
  --bot-pat "$LEADTIME_BOT_PAT" \
  --webhook-secret "$LEADTIME_WEBHOOK_SECRET" \
  --agent-id main \
  --mode basic
```

When using `--claim`, Leadtime saves the webhook URL during claim. With manual setup, save `https://agent.example.com/leadtime/webhook` in Leadtime yourself.

## Agent-Assisted Setup

If you prefer to let a coding agent configure your existing OpenClaw installation, generate a prompt:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin --print-agent-prompt \
  --leadtime-base-url https://leadtime.app \
  --bot-user-id leadtime-bot-user-id
```

Paste the generated prompt from Leadtime into Codex, OpenClaw, Claude Code, Cursor, or another coding agent that has access to your OpenClaw machine. The prompt uses the one-time setup code, so you do not need to paste a bot PAT or webhook signing secret manually.

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
          "openClawGatewayBaseUrl": "http://127.0.0.1:18789",
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
