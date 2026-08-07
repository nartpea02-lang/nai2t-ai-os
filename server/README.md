# NAI2T · Luzy backend

The agentic brain for Luzy. A sandboxed tool-use loop over the Anthropic Messages API,
exposed to the static NAI2T frontend over a WebSocket. **The Anthropic API key lives only
here (server env) and is never sent to the browser.**

## What it does
Luzy can **reason → plan → act**: inspect real project files, search them, run real shell
commands in an isolated workspace, and delegate sub-tasks to read-only sub-agents — streaming
every step (thinking, tool calls, command output, sub-agent progress) back to the UI in real time.

## Safety model
- **Sandboxed to one workspace dir.** All file tools resolve-and-confine to `WORKSPACE_DIR`; any
  path that escapes the tree is rejected. `run_command` runs with `cwd` = workspace.
- **Destructive commands require explicit UI confirmation** before they run (`rm`, `mv`, `git push`,
  `dd`, …). Truly irrecoverable/host-level commands (`mkfs`, fork bombs, `shutdown`) are refused outright.
- **Output & turn caps**, command timeout, and per-connection interrupt.
- **Origin-checked** WebSocket (`ALLOWED_ORIGINS`).

## Run locally
```bash
cd server
cp .env.example .env      # fill in ANTHROPIC_API_KEY
npm install
npm start                 # ws://localhost:8787/ws , GET /health
```

## Deploy (Render)
1. Push this repo. In Render: **New → Blueprint**, pick this repo (`render.yaml` is under `server/`).
2. Set **`ANTHROPIC_API_KEY`** (secret) and **`ALLOWED_ORIGINS`** (your Netlify URL) in the dashboard.
3. Deploy. Point the frontend at the service URL (see `window.NAI2T_BACKEND` in the site).

## WebSocket protocol
Client → server: `{type:'user_message',text}` · `{type:'confirm',id,allow}` · `{type:'interrupt'}`
Server → client: `ready · status · thinking_delta · assistant_delta · assistant · tool_call ·
tool_output_delta · tool_result · subagent · confirm_required · error · done`

The frontend degrades gracefully: if this backend is unreachable, the Terminal and sub-agent
features show "unavailable" and the rest of the offline app keeps working.
