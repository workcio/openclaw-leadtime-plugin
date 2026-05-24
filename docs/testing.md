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
| Private connector URL | Leadtime cannot deliver webhooks unless the connector URL is reachable from Leadtime. |

## Development Harness

`examples/docker-compose.yml` exists only to test the plugin from a clean OpenClaw state without touching a personal gateway. It is not the recommended user deployment shape.

### Start Clean OpenClaw In Docker

From the Leadtime repo, the shortcut is:

```bash
npm run openclaw-plugin-docker
```

The shortcut prepares `.local/openclaw-state` before Docker starts: it reads `OPENROUTER_API_KEY` from the shell or the Leadtime root `.env`, writes an OpenRouter provider into the Docker state, sets the test model to `openrouter/moonshotai/kimi-k2.6`, disables memory search, copies the host `~/.openclaw/agents/main/agent/auth-profiles.json` when present, and keeps OpenClaw bootstrap guidance disabled for headless plugin sessions.

Override the model from the Leadtime repo when needed:

```bash
npm run openclaw-plugin-docker -- --model openrouter/openrouter/hunter-alpha
```

Run this from the plugin repo root:

```bash
cd /Users/stas/Apps/openclaw-leadtime-plugin

export PLUGIN_SOURCE_DIR="$PWD"
export OPENCLAW_STATE_DIR="$PWD/.local/openclaw-state"
export CODEX_STATE_DIR="$HOME/.codex"
export OPENCLAW_GATEWAY_TOKEN="leadtime-dev-openclaw"
export OPENROUTER_API_KEY="$OPENROUTER_API_KEY"
export OPENCLAW_TEST_MODEL="openrouter/moonshotai/kimi-k2.6"

docker compose \
  --env-file examples/.env.example \
  -f examples/docker-compose.yml \
  up --build
```

The harness uses `node:24-bookworm`, installs the requested OpenClaw version, copies this plugin source into the container, links the plugin into OpenClaw, starts a gateway on `http://localhost:19011`, and starts the Leadtime connector on `http://localhost:19339/leadtime/webhook`. Keep `.local/openclaw-state` if you want the same OpenClaw identity/config between runs; delete it for a clean gateway.

Check the gateway from the host:

```bash
curl -sSI http://localhost:19011/ | head -1
```

Reset the OpenClaw test identity/config:

```bash
rm -rf /Users/stas/Apps/openclaw-leadtime-plugin/.local/openclaw-state
```

### Connect To Local Leadtime

Start local Leadtime from the Leadtime repo root:

```bash
npx nx run local-services:up
npm run dev
```

Confirm:

```bash
curl -sS http://localhost:9221/api/test/health
curl -sSI http://localhost:9220/ | head -1
```

In Leadtime:

1. Open Workspace Settings -> Bots.
2. Create or open a self-hosted bot.
3. Open OpenClaw setup helper.
4. Generate a one-time setup code.

Or from the Leadtime repo, create/reuse a local bot and print the setup command:

```bash
npm run provision-openclaw-plugin -- --bot-name "OpenClaw Local Bot" --mode basic
```

For full mode:

```bash
npm run provision-openclaw-plugin -- \
  --bot-name "OpenClaw Full Local Bot" \
  --mode full \
  --expose-raw-api-credential-to-agent
```

Run setup from the plugin repo root:

```bash
npx --yes github:workcio/openclaw-leadtime-plugin setup \
  --leadtime-base-url http://host.docker.internal:9221/api \
  --claim "<lt_conn_... setup code>" \
  --agent-id main \
  --mode basic
```

Use `http://host.docker.internal:9221/api`, not `http://localhost:9221/api`, because the setup runs for the Dockerized OpenClaw environment. The webhook URL saved in Leadtime should point to the connector, `http://localhost:19339/leadtime/webhook`, for local host tests. For Leadtime Cloud, expose the connector port through stable public HTTPS instead of exposing the full OpenClaw gateway.

After setup, assign or mention the bot on a Leadtime task. Expected result: Leadtime creates a session card, sends the webhook to the OpenClaw plugin, the plugin reports activity, and the bot writes a normal task comment.

### Agent Setup Prompt

Use this prompt when another coding agent should reproduce the harness:

```text
Set up the Leadtime OpenClaw plugin Docker harness for local Leadtime.

Use /Users/stas/Apps/openclaw-leadtime-plugin/docs/testing.md and the Leadtime docs at docs/03-domains/custom-agents/local-development-harnesses.md.

Start local Leadtime and verify http://localhost:9221/api/test/health. From the Leadtime repo, run npm run openclaw-plugin-docker.

In another terminal from the Leadtime repo, run npm run provision-openclaw-plugin -- --bot-name "OpenClaw Local Bot" --mode basic. Run the printed setup command on the OpenClaw machine/container. Do not use localhost:9221 from inside Docker; use http://host.docker.internal:9221/api. Assign the bot to a test task and verify a session card, plugin activity, and a bot task comment.
```
