// Express (health) + WebSocket (agent) server. The Anthropic key never leaves here.
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config, assertConfigured } from './config.js';
import { Session } from './agent.js';
import { ensureWorkspace } from './sandbox.js';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nai2t-luzy', model: config.model, configured: !!config.apiKey });
});
app.get('/', (_req, res) => res.type('text').send('NAI2T Luzy backend. Connect via WebSocket /ws'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function originAllowed(origin) {
  if (!origin) return true;                        // native/CLI clients
  if (config.allowedOrigins.includes('*')) return true;
  return config.allowedOrigins.includes(origin);
}

wss.on('connection', (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, 'origin not allowed');
    return;
  }
  const send = (event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)); };
  const session = new Session(send);
  send({ type: 'ready', model: config.model });

  ws.on('message', (raw) => {
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
    }
  });

  ws.on('close', () => session.interrupt());
  ws.on('error', () => session.interrupt());
});

async function main() {
  assertConfigured();
  await ensureWorkspace();
  server.listen(config.port, () => {
    console.log(`NAI2T Luzy backend on :${config.port} (model ${config.model}, workspace ${config.workspaceDir})`);
  });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
