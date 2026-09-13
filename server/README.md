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
1. In Render: **New → Blueprint**, pick this repo. Render reads `render.yaml` from the
   **repository root** (it declares `rootDir: server`, so this folder is the service).
   Make sure the branch you select is one that actually contains `render.yaml`.
2. Set **`ANTHROPIC_API_KEY`** (secret) and **`ALLOWED_ORIGINS`** (your Netlify URL, exact
   origin — no trailing slash, e.g. `https://your-site.netlify.app`) in the dashboard.
3. Deploy, then point the frontend at the service URL. Three ways, checked in this order —
   no rebuild needed for the first two:
   - Open the HQ page's **Terminal** panel and paste `wss://<service>.onrender.com/ws` into
     the backend field and click "เชื่อมต่อ" — it's saved in the browser and reused on reload.
   - Append `?backend=wss://<service>.onrender.com/ws` to the page URL (also saves it).
   - Set `window.NAI2T_BACKEND` in `public/hq/index.html` as a site-wide default.
   A bare host or an `https://` URL both work — the client normalizes to `wss://…/ws`.
   Render's free/starter plan sleeps on idle: the client's app-level ping and automatic
   reconnect-with-backoff ride that out, so a cold start just shows "กำลังเชื่อมต่อ" briefly.

## WebSocket protocol
Client → server: `{type:'user_message',text}` · `{type:'confirm',id,allow}` ·
`{type:'interrupt'}` · `{type:'ping'}`
Server → client: `ready · status · thinking_delta · assistant_delta · assistant · tool_call ·
tool_output_delta · tool_result · subagent · confirm_required · error · done · pong`

`/health` also sends `Access-Control-Allow-Origin` for allowed origins, since the frontend
pre-flights it from the browser before opening the socket, to tell an operator *why* a
connection will fail (asleep vs. misconfigured) rather than just "unreachable".

The frontend degrades gracefully: if this backend is unreachable, the Terminal and sub-agent
features show "unavailable" and the rest of the offline app keeps working. If the origin is
rejected (`ALLOWED_ORIGINS`), the Terminal log says so explicitly instead of just retrying
forever. `tests/stub-backend.js` implements this same protocol without an API key, so
`npm test` (Playwright) exercises the live path end-to-end — see `tests/live.spec.js`.
