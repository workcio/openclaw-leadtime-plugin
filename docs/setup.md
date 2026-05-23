# Setup

Use this plugin with an existing OpenClaw gateway on your laptop, workstation, or VPS. Docker is only a development smoke-test harness for this repository.

## What You Need

- A Leadtime self-hosted bot.
- A one-time setup code from the bot's OpenClaw setup helper.
- An OpenClaw gateway URL that Leadtime can reach.
- The OpenClaw agent id to run, usually `main`.

If your OpenClaw gateway is only available on a private network such as Tailscale, Leadtime Cloud cannot call it unless Leadtime is also inside that network. Use a public HTTPS reverse proxy, Tailscale Funnel, a named Cloudflare Tunnel, or a publicly reachable VPS URL for the webhook endpoint.

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

Claiming the setup code enables webhooks/sessions in Leadtime, creates a fresh bot PAT, stores the OpenClaw webhook URL, patches `~/.openclaw/openclaw.json`, enables the plugin, and sets `agents.defaults.skipBootstrap=true` for clean headless task sessions. The wizard resolves the gateway public URL on the OpenClaw machine from existing config or environment. If it detects a local/private URL for Leadtime Cloud, it stops before claiming the setup code and prints setup options.

Restart your OpenClaw gateway after the wizard.

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

For fully headless installs, provide `LEADTIME_OPENCLAW_GATEWAY_PUBLIC_URL=https://openclaw.example.com` or pass `--gateway-public-url`. Interactive installs do not need it in the generated Leadtime command.

## Private Networks

Leadtime webhooks require Leadtime to call your OpenClaw gateway. A local URL, LAN address, or Tailscale-only Serve URL is not enough for Leadtime Cloud.

Recommended options:

- Tailscale Funnel: use OpenClaw's Funnel mode, for example `openclaw gateway --tailscale funnel --auth password`.
- Named Cloudflare Tunnel: stable and suitable for production when mapped to your own hostname.
- Reverse proxy: expose `http://127.0.0.1:18789` through nginx, Caddy, Traefik, or a similar HTTPS proxy.

Cloudflare Quick Tunnels are useful for temporary testing, but they are not a permanent bot webhook URL because account-less quick tunnel hostnames are not guaranteed stable.

Manual setup is still available for custom wrappers or advanced debugging:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin setup \
  --leadtime-base-url https://leadtime.app \
  --gateway-public-url https://openclaw.example.com \
  --bot-user-id leadtime-bot-user-id \
  --bot-pat "$LEADTIME_BOT_PAT" \
  --webhook-secret "$LEADTIME_WEBHOOK_SECRET" \
  --agent-id main \
  --mode basic
```

When using `--claim`, Leadtime saves the webhook URL during claim. With manual setup, save `https://openclaw.example.com/leadtime/webhook` in Leadtime yourself.

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
