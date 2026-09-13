/* Stub Luzy backend for tests.
   Speaks the same WebSocket protocol as server/src/server.js but with scripted,
   deterministic responses and no Anthropic API key — so the live integration
   (connect, stream, confirm, reconnect, origin rejection) is exercised for real.

   Scripted by the text of the user message:
     contains 'ลบ'    -> destructive command flow, waits for a confirm
     contains 'drop'  -> server drops the socket (reconnect path)
     otherwise        -> streamed answer
   Query flags on /ws:  ?reject=1 -> close 1008 like an origin rejection */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.STUB_PORT || 4322;
const MODEL = 'claude-opus-5-stub';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'nai2t-luzy-stub', model: MODEL, configured: true }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.searchParams.get('reject')) { ws.close(1008, 'origin not allowed'); return; }
    wss.emit('connection', ws);
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

wss.on('connection', (ws) => {
  const send = (e) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e)); };
  let pendingConfirm = null;

  send({ type: 'ready', model: MODEL });

  async function answer(text) {
    send({ type: 'status', state: 'thinking', label: 'กำลังคิด…' });
    await wait(30);
    for (const chunk of ['รับทราบครับ ', 'กำลังตรวจสอบ', 'สถานะงานให้']) {
      send({ type: 'assistant_delta', text: chunk });
      await wait(20);
    }
    send({ type: 'assistant' });
    send({ type: 'tool_call', name: 'read_file', input: { path: 'notes.md' } });
    send({ type: 'tool_result', ok: true, summary: 'อ่านไฟล์แล้ว' });
    send({ type: 'subagent', id: 'sa1', label: 'ผู้ช่วยค้นข้อมูล', state: 'running', action: 'grep' });
    await wait(20);
    send({ type: 'subagent', id: 'sa1', label: 'ผู้ช่วยค้นข้อมูล', state: 'done' });
    send({ type: 'done' });
  }

  async function destructive(command) {
    // The real backend announces the tool call *before* it is allowed to run,
    // and only re-announces with running:true once the user approves.
    send({ type: 'tool_call', name: 'run_command', input: { command }, running: false });
    pendingConfirm = { id: 'c1', command };
    send({ type: 'confirm_required', id: 'c1', command, reason: 'คำสั่งนี้ลบไฟล์ถาวร' });
  }

  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.type === 'ping') { send({ type: 'pong' }); return; }

    if (m.type === 'interrupt') {
      send({ type: 'assistant', text: 'หยุดให้แล้วครับ' });
      send({ type: 'done' });
      return;
    }

    if (m.type === 'confirm') {
      const c = pendingConfirm;
      pendingConfirm = null;
      if (!c || c.id !== m.id) return;
      if (!m.allow) {
        send({ type: 'tool_result', ok: false, summary: 'ผู้ใช้ไม่อนุมัติ' });
        send({ type: 'assistant', text: 'ยกเลิกคำสั่งแล้วครับ' });
        send({ type: 'done' });
        return;
      }
      send({ type: 'tool_call', name: 'run_command', input: { command: c.command }, running: true });
      send({ type: 'tool_output_delta', chunk: 'removed old.log\n' });
      send({ type: 'tool_result', ok: true, summary: 'exit 0' });
      send({ type: 'assistant', text: 'ลบไฟล์เรียบร้อยครับ' });
      send({ type: 'done' });
      return;
    }

    if (m.type !== 'user_message') return;
    const text = String(m.text || '');
    if (text.includes('drop')) { ws.close(1011, 'simulated drop'); return; }
    if (text.includes('ลบ')) { await destructive('rm -rf old.log'); return; }
    await answer(text);
  });
});

server.listen(PORT, () => console.log('stub Luzy backend on ws://localhost:' + PORT + '/ws'));
module.exports = server;
