/* Integration test for Luzy's agent loop — no API key required.
 * Stands up a mock Anthropic-compatible streaming endpoint, points the SDK at it,
 * and drives real turns so the loop, sandbox execution, confirmation gating and
 * event stream are all exercised end to end.
 *
 * Run: node test/agent-loop.test.mjs
 */
import http from 'node:http';
import assert from 'node:assert/strict';

// ── Mock Anthropic streaming endpoint ────────────────────────────────
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Emits one assistant message: optional text, optional tool_use, given stop_reason.
function emitMessage(res, { text, tool, stopReason }) {
  sse(res, 'message_start', {
    type: 'message_start',
    message: { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant',
      model: 'mock', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 } },
  });
  let idx = 0;
  if (text) {
    sse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } });
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
    idx++;
  }
  if (tool) {
    sse(res, 'content_block_start', { type: 'content_block_start', index: idx,
      content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
  }
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

let script = [];      // queue of responses the mock will return, in order
let received = [];    // request bodies the mock saw

// Non-streaming shape, for callers that use messages.create() (the sub-agent does).
function jsonMessage({ text, tool, stopReason }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  if (tool) content.push({ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input });
  return { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant',
    model: 'mock', content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 } };
}

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    received.push(parsed);
    const next = script.shift() || { text: 'จบแล้ว', stopReason: 'end_turn' };
    if (parsed && parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      emitMessage(res, next);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jsonMessage(next)));
    }
  });
});

await new Promise((r) => mock.listen(0, r));
const mockPort = mock.address().port;

// ── Point the SDK + config at the mock, then load the agent ──────────
process.env.ANTHROPIC_API_KEY = 'sk-ant-mock';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mockPort}`;
process.env.WORKSPACE_DIR = './workspace-test';
process.env.CMD_TIMEOUT_MS = '15000';

const { Session } = await import('../src/agent.js');

function newSession() {
  const events = [];
  const s = new Session((e) => events.push(e));
  return { s, events };
}
const types = (events) => events.map((e) => e.type);
const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures.push(name); console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// ── Test 1: safe command runs for real, output streams back ──────────
console.log('\nTest 1 — safe run_command executes and streams output');
script = [
  { text: 'กำลังตรวจสอบให้ครับ', tool: { id: 'toolu_1', name: 'run_command', input: { command: 'echo NAI2T_OK' } }, stopReason: 'tool_use' },
  { text: 'เรียบร้อยครับ ผลลัพธ์คือ NAI2T_OK', stopReason: 'end_turn' },
];
received = [];
{
  const { s, events } = newSession();
  await s.handleUserMessage('รันคำสั่ง echo ให้หน่อย');

  check('emits tool_call for run_command', () => {
    assert.ok(events.some((e) => e.type === 'tool_call' && e.name === 'run_command'));
  });
  check('command actually executed in the sandbox (real stdout streamed)', () => {
    const out = events.filter((e) => e.type === 'tool_output_delta').map((e) => e.chunk).join('');
    assert.match(out, /NAI2T_OK/);
  });
  check('tool_result reports success', () => {
    const r = events.find((e) => e.type === 'tool_result' && e.name === 'run_command');
    assert.ok(r && r.ok === true, 'expected ok tool_result, got ' + JSON.stringify(r));
  });
  check('real stdout was fed back to the model', () => {
    const followup = received[1];
    const toolResult = followup.messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.match(toolResult.content, /NAI2T_OK/);
  });
  check('final assistant text delivered, then done', () => {
    assert.ok(events.some((e) => e.type === 'assistant' && /NAI2T_OK/.test(e.text)));
    assert.equal(types(events).at(-1), 'done');
  });
}

// ── Test 2: destructive command is gated on user confirmation ────────
console.log('\nTest 2 — destructive command requires confirmation (denied)');
script = [
  { text: 'จะลบไฟล์ให้ครับ', tool: { id: 'toolu_2', name: 'run_command', input: { command: 'rm -rf important-data' } }, stopReason: 'tool_use' },
  { text: 'รับทราบครับ ไม่ได้ลบ', stopReason: 'end_turn' },
];
received = [];
{
  const { s, events } = newSession();
  const turn = s.handleUserMessage('ลบ important-data ที');
  // Wait for the gate, then deny.
  const asked = await new Promise((resolve) => {
    const iv = setInterval(() => {
      const c = events.find((e) => e.type === 'confirm_required');
      if (c) { clearInterval(iv); resolve(c); }
    }, 20);
    setTimeout(() => { clearInterval(iv); resolve(null); }, 5000);
  });
  check('destructive command triggers confirm_required BEFORE running', () => {
    assert.ok(asked, 'no confirm_required event was emitted');
    assert.match(asked.command, /rm -rf/);
    assert.ok(!events.some((e) => e.type === 'tool_output_delta'), 'command produced output before confirmation');
  });
  s.confirm(asked.id, false);   // user denies
  await turn;
  check('denied command never executes', () => {
    assert.ok(!events.some((e) => e.type === 'tool_output_delta'));
  });
  check('model is told the user declined', () => {
    const followup = received[1];
    const toolResult = followup.messages.at(-1).content[0];
    assert.match(toolResult.content, /ไม่อนุมัติ/);
  });
}

// ── Test 3: forbidden command refused outright, no prompt ────────────
console.log('\nTest 3 — irrecoverable command refused without prompting');
script = [
  { tool: { id: 'toolu_3', name: 'run_command', input: { command: 'shutdown -h now' } }, stopReason: 'tool_use' },
  { text: 'ปฏิเสธแล้วครับ', stopReason: 'end_turn' },
];
received = [];
{
  const { s, events } = newSession();
  await s.handleUserMessage('ปิดเครื่อง');
  check('no confirmation is offered for a forbidden command', () => {
    assert.ok(!events.some((e) => e.type === 'confirm_required'));
  });
  check('command is refused and never runs', () => {
    assert.ok(!events.some((e) => e.type === 'tool_output_delta'));
    const followup = received[1];
    assert.match(followup.messages.at(-1).content[0].content, /ปฏิเสธ/);
  });
}

// ── Test 4: path escape from the sandbox is blocked ──────────────────
console.log('\nTest 4 — read_file cannot escape the workspace');
script = [
  { tool: { id: 'toolu_4', name: 'read_file', input: { path: '../../../../etc/passwd' } }, stopReason: 'tool_use' },
  { text: 'อ่านไม่ได้ครับ', stopReason: 'end_turn' },
];
received = [];
{
  const { s, events } = newSession();
  await s.handleUserMessage('อ่าน /etc/passwd');
  check('escape attempt returns an error, not file contents', () => {
    const followup = received[1];
    const tr = followup.messages.at(-1).content[0];
    assert.equal(tr.is_error, true, 'expected is_error on the tool result');
    assert.doesNotMatch(tr.content, /root:/, 'workspace escape leaked /etc/passwd');
  });
}

// ── Test 5: sub-agent dispatch reports progress and returns a result ──
console.log('\nTest 5 — dispatch_subagent runs a scoped worker');
script = [
  { tool: { id: 'toolu_5', name: 'dispatch_subagent', input: { goal: 'สรุปไฟล์ในโปรเจกต์' } }, stopReason: 'tool_use' },
  // the sub-agent's own loop hits the mock next:
  { text: 'พบไฟล์ README.md หนึ่งไฟล์', stopReason: 'end_turn' },
  { text: 'สรุปให้แล้วครับ', stopReason: 'end_turn' },
];
received = [];
{
  const { s, events } = newSession();
  await s.handleUserMessage('ให้ sub-agent ไปสรุปไฟล์');
  check('sub-agent status events are streamed for the UI', () => {
    const sa = events.filter((e) => e.type === 'subagent');
    assert.ok(sa.length > 0, 'no subagent events');
    assert.ok(sa.some((e) => e.state === 'done'), 'sub-agent never reported done');
  });
  check("sub-agent's answer is returned to Luzy", () => {
    const followup = received.at(-1);
    assert.match(followup.messages.at(-1).content[0].content, /README/);
  });
}

// ── Test 6: a mid-loop failure leaves the session usable ─────────────
console.log('\nTest 6 — session survives a mid-turn API failure');
{
  const { s, events } = newSession();
  s.messages = [
    { role: 'user', content: 'ก่อนหน้า' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'run_command', input: {} }] },
  ];
  s.repairDanglingToolUse();
  check('open tool calls are closed so the next turn is valid', () => {
    const last = s.messages.at(-1);
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].tool_use_id, 'tu_x');
    assert.equal(last.content[0].is_error, true);
  });
}

mock.close();
console.log(failures.length ? `\n✗ ${failures.length} check(s) failed: ${failures.join(', ')}` : '\n✓ all agent-loop checks passed');
process.exit(failures.length ? 1 : 0);
