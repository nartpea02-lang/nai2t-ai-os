// Tool schemas (sent to the model) and their server-side executors.
// dispatch_subagent is added by agent.js so the sub-agent runner can be injected.
import * as sb from './sandbox.js';

export const baseToolSchemas = [
  {
    name: 'list_files',
    description: 'แสดงรายชื่อไฟล์และโฟลเดอร์ภายในพื้นที่ทำงาน (workspace) เท่านั้น ใช้เพื่อสำรวจโครงสร้างโปรเจกต์ก่อนอ่านไฟล์',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'เส้นทางแบบสัมพัทธ์ในพื้นที่ทำงาน เว้นว่าง = รากของพื้นที่ทำงาน' } },
    },
  },
  {
    name: 'read_file',
    description: 'อ่านเนื้อหาไฟล์ข้อความภายในพื้นที่ทำงาน ใช้ตรวจสอบโค้ดหรือข้อมูลจริง (อ่านอย่างเดียว ไม่แก้ไข)',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'เส้นทางไฟล์แบบสัมพัทธ์ในพื้นที่ทำงาน' } },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'ค้นหาข้อความ/รูปแบบ (regex) ในไฟล์ทั้งหมดของพื้นที่ทำงาน คืนไฟล์+บรรทัดที่ตรง ใช้หาว่าโค้ดหรือข้อมูลอยู่ที่ไหน',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'คำหรือ regex ที่ต้องการค้นหา' },
        path: { type: 'string', description: 'จำกัดขอบเขตการค้นหา (เว้นว่าง = ทั้งพื้นที่ทำงาน)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description: 'รันคำสั่ง shell จริงภายในพื้นที่ทำงานที่แยกออกมา (sandbox) เอาต์พุตจะสตรีมกลับแบบเรียลไทม์ คำสั่งที่อาจทำลายข้อมูลจะต้องให้ผู้ใช้ยืนยันก่อนเสมอ',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'คำสั่ง bash ที่จะรันในพื้นที่ทำงาน' } },
      required: ['command'],
    },
  },
];

// executors: (input, ctx) => Promise<{ text, ok }>
// ctx = { emit(event), requestConfirmation({command,reason}) -> Promise<boolean>, signal, toolUseId }
export const executors = {
  async list_files(input, ctx) {
    const res = await sb.listFiles(input.path || '.');
    const lines = res.entries.map(e => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`).join('\n');
    ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'list_files', ok: true, summary: `${res.entries.length} รายการใน ${res.path}` });
    return { ok: true, text: `พื้นที่ ${res.path}:\n${lines || '(ว่าง)'}` };
  },

  async read_file(input, ctx) {
    const text = await sb.readFile(input.path);
    ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'read_file', ok: true, summary: `อ่าน ${input.path}` });
    return { ok: true, text };
  },

  async search_files(input, ctx) {
    const res = await sb.searchFiles(input.query, input.path || '.');
    const lines = res.map(r => `${r.file}:${r.line}: ${r.text}`).join('\n');
    ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'search_files', ok: true, summary: `พบ ${res.length} รายการ` });
    return { ok: true, text: res.length ? lines : `ไม่พบ "${input.query}"` };
  },

  async run_command(input, ctx) {
    const cmd = String(input.command || '').trim();
    const cls = sb.classifyCommand(cmd);
    if (cls === 'forbidden') {
      ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'run_command', ok: false, summary: 'ปฏิเสธคำสั่งอันตราย' });
      return { ok: false, text: `ปฏิเสธคำสั่งนี้เพื่อความปลอดภัย (อาจทำลายระบบอย่างกู้คืนไม่ได้): ${cmd}` };
    }
    if (cls === 'destructive') {
      const allowed = await ctx.requestConfirmation({ command: cmd, reason: 'คำสั่งนี้อาจแก้ไข/ลบข้อมูล ต้องการยืนยันก่อนรัน' });
      if (!allowed) {
        ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'run_command', ok: false, summary: 'ผู้ใช้ยกเลิก' });
        return { ok: false, text: 'ผู้ใช้ไม่อนุมัติให้รันคำสั่งนี้ ข้ามไป' };
      }
    }
    ctx.emit({ type: 'tool_call', id: ctx.toolUseId, name: 'run_command', input: { command: cmd }, running: true });
    const res = await sb.runCommand(cmd, {
      signal: ctx.signal,
      onChunk: (chunk) => ctx.emit({ type: 'tool_output_delta', id: ctx.toolUseId, chunk }),
    });
    ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'run_command', ok: res.ok, summary: `exit ${res.code}` });
    return { ok: res.ok, text: `$ ${cmd}\n(exit ${res.code})\n${res.output}` };
  },
};
