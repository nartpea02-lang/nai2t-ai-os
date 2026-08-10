// Express (health) + WebSocket (agent) server. The Anthropic key never leaves here.
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config, assertConfigured } from './config.js';
import { Session } from './agent.js';
import { ensureWorkspace } from './sandbox.js';

const app = express();

function originAllowed(origin) {
  if (!origin) return true;                        // native/CLI clients
  if (config.allowedOrigins.includes('*')) return true;
  return config.allowedOrigins.includes(origin);
}

// The frontend pre-flights /health from the browser to diagnose a bad endpoint,
// so the allowed origins need CORS here too — not just on the socket.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nai2t-luzy', model: config.model, configured: !!config.apiKey });
});
app.get('/', (_req, res) => res.type('text').send('NAI2T Luzy backend. Connect via WebSocket /ws'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, 'origin not allowed');
    return;
  }
  const send = (event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)); };
  const session = new Session(send);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send({ type: 'ready', model: config.model });

  ws.on('message', (raw) => {
    ws.isAlive = true;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'user_message':
        if (typeof msg.text === 'string' && msg.text.trim()) session.handleUserMessage(msg.text.trim());
        break;
      case 'confirm':
        session.confirm(msg.id, !!msg.allow);
        break;
      case 'interrupt':
        session.interrupt();
        break;
      case 'ping':
        // App-level keepalive: hosting proxies drop sockets that go quiet.
        send({ type: 'pong' });
        break;
    }
  });

  ws.on('close', () => session.interrupt());
  ws.on('error', () => session.interrupt());
});

// Reap sockets whose peer vanished without a close frame (mobile sleep, NAT drop).
const reaper = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* already gone */ }
  });
}, 30000);
wss.on('close', () => clearInterval(reaper));

async function main() {
  assertConfigured();
  await ensureWorkspace();
  server.listen(config.port, () => {
    console.log(`NAI2T Luzy backend on :${config.port} (model ${config.model}, workspace ${config.workspaceDir})`);
  });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
