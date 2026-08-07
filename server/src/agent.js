// Luzy's brain: a streaming tool-use loop over the Anthropic Messages API.
// One Session per WebSocket connection. Emits real-time status the UI turns into
// avatar states, a live Terminal, and a sub-agent feed.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { baseToolSchemas, executors } from './tools.js';
import { dispatchSubagentTool } from './subagent.js';
import { ensureWorkspace, workspaceRoot } from './sandbox.js';

const SYSTEM = `คุณคือ "Luzy" ผู้ช่วย AI ของศูนย์บัญชาการ (HQ) ในระบบ NAI2T AI OS
คุณไม่ได้เป็นแค่แชท — คุณลงมือทำงานจริงได้ผ่านเครื่องมือในพื้นที่ทำงานที่ปลอดภัย (sandbox) เท่านั้น:
- list_files / read_file / search_files : สำรวจและอ่านไฟล์/ข้อมูลจริงในโปรเจกต์
- run_command : รันคำสั่ง shell จริง (คำสั่งที่อาจทำลายข้อมูลจะขอให้ผู้ใช้ยืนยันก่อนอัตโนมัติ)
- dispatch_subagent : มอบหมายงานย่อยให้ sub-agent ทำแบบขนาน แล้วรวมผล

หลักการทำงาน:
1) เมื่อได้รับคำสั่งที่ต้องลงมือทำ ให้วางแผนสั้น ๆ ก่อน แล้วอธิบายให้ผู้ใช้เห็นว่าจะทำอะไร
2) ลงมือด้วยเครื่องมือจริง อ้างอิงผลลัพธ์จริงเสมอ ห้ามกุข้อมูล
3) สรุปผลกลับเป็นภาษาพูดที่กระชับ เป็นธรรมชาติ
พูดภาษาไทยเป็นหลัก ตอบกระชับ ตรงประเด็น ทำงานในพื้นที่ทำงานเท่านั้น`;

export class Session {
  constructor(send) {
    this.send = send;                 // (event) => void   — serialize + ws.send
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.messages = [];
    this.busy = false;
    this.pending = new Map();         // confirmId -> resolve(boolean)
    this.abort = null;
  }

  emit(event) { try { this.send(event); } catch {} }

  confirm(id, allow) {
    const resolve = this.pending.get(id);
    if (resolve) { this.pending.delete(id); resolve(!!allow); }
  }

  interrupt() { this.abort?.abort(); }

  requestConfirmation({ command, reason }) {
    const id = 'cf' + Math.random().toString(36).slice(2, 9);
    this.emit({ type: 'confirm_required', id, command, reason });
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      // auto-deny if the connection goes away or is interrupted
      this.abort?.signal.addEventListener('abort', () => {
        if (this.pending.has(id)) { this.pending.delete(id); resolve(false); }
      }, { once: true });
    });
  }

  async handleUserMessage(text) {
    if (this.busy) { this.emit({ type: 'error', message: 'Luzy กำลังทำงานอยู่ กรุณารอสักครู่' }); return; }
    this.busy = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    await ensureWorkspace();

    this.messages.push({ role: 'user', content: text });

    // Tool set: base read/exec tools + a dispatch_subagent bound to this session's client/emit.
    const sub = dispatchSubagentTool(this.client, (e) => this.emit(e), signal);
    const toolSchemas = [...baseToolSchemas, sub.schema];
    const execMap = { ...executors, dispatch_subagent: sub.exec };

    try {
      for (let turn = 0; turn < config.maxTurns; turn++) {
        if (signal.aborted) { this.emit({ type: 'status', state: 'idle', label: 'หยุดแล้ว' }); break; }
        this.emit({ type: 'status', state: 'thinking', label: 'กำลังคิด…' });

        const stream = this.client.messages.stream({
          model: config.model,
          max_tokens: 32000,
          system: SYSTEM,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: config.effort },
          tools: toolSchemas,
          messages: this.messages,
        }, { signal });

        stream.on('thinking', (delta) => this.emit({ type: 'thinking_delta', text: delta }));
        let spoke = false;
        stream.on('text', (delta) => {
          if (!spoke) { spoke = true; this.emit({ type: 'status', state: 'speaking', label: '' }); }
          this.emit({ type: 'assistant_delta', text: delta });
        });

        const msg = await stream.finalMessage();
        this.messages.push({ role: 'assistant', content: msg.content });

        const finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (finalText) this.emit({ type: 'assistant', text: finalText });

        if (msg.stop_reason !== 'tool_use') break;

        // Execute every requested tool, return all results in one user turn.
        this.emit({ type: 'status', state: 'running', label: 'กำลังดำเนินการ…' });
        const toolResults = [];
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          this.emit({ type: 'tool_call', id: block.id, name: block.name, input: block.input });
          const exec = execMap[block.name];
          const ctx = {
            toolUseId: block.id,
            signal,
            emit: (e) => this.emit(e),
            requestConfirmation: (o) => this.requestConfirmation(o),
          };
          try {
            const out = exec
              ? await exec(block.input, ctx)
              : { ok: false, text: `ไม่รู้จักเครื่องมือ ${block.name}` };
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: out.text, is_error: !out.ok });
          } catch (e) {
            this.emit({ type: 'tool_result', id: block.id, name: block.name, ok: false, summary: e.message });
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `ผิดพลาด: ${e.message}`, is_error: true });
          }
        }
        this.messages.push({ role: 'user', content: toolResults });
      }
    } catch (e) {
      if (!signal.aborted) this.emit({ type: 'error', message: e.message || String(e) });
    } finally {
      this.busy = false;
      this.emit({ type: 'status', state: 'idle', label: '' });
      this.emit({ type: 'done' });
    }
  }
}

export { workspaceRoot };
