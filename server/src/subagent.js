// A scoped sub-agent worker. Runs its own tool-use loop with READ-ONLY tools and a
// cheaper model, streaming status to the client so its progress is visible near the avatar.
import { config } from './config.js';
import { baseToolSchemas, executors } from './tools.js';

const READONLY = ['list_files', 'read_file', 'search_files'];
const roSchemas = baseToolSchemas.filter(t => READONLY.includes(t.name));

let counter = 0;

export async function runSubagent({ client, goal, context, emit, signal }) {
  const id = 'sa' + (++counter) + '-' + Math.random().toString(36).slice(2, 6);
  const label = String(goal || '').slice(0, 80);
  emit({ type: 'subagent', id, state: 'planning', label, goal: label });

  const system =
    'คุณคือ sub-agent ของ Luzy ในระบบ NAI2T ได้รับมอบหมายงานย่อยที่ชัดเจนหนึ่งงาน ' +
    'คุณมีเครื่องมืออ่านอย่างเดียว (list_files, read_file, search_files) ในพื้นที่ทำงานที่ปลอดภัย ' +
    'ทำงานที่ได้รับให้เสร็จแล้วสรุปผลสั้น กระชับ พร้อมอ้างอิงไฟล์/บรรทัดที่เกี่ยวข้อง ห้ามเดา';

  const messages = [{
    role: 'user',
    content: `เป้าหมาย: ${goal}` + (context ? `\n\nบริบทเพิ่มเติม:\n${context}` : ''),
  }];

  try {
    for (let turn = 0; turn < 8; turn++) {
      if (signal?.aborted) break;
      emit({ type: 'subagent', id, state: 'thinking', label });
      const res = await client.messages.create({
        model: config.subagentModel,
        max_tokens: 8000,
        system,
        tools: roSchemas,
        messages,
      });
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason !== 'tool_use') {
        const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        emit({ type: 'subagent', id, state: 'done', label, summary: text.slice(0, 160) });
        return text || '(sub-agent ไม่มีผลลัพธ์ที่เป็นข้อความ)';
      }

      const toolResults = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        emit({ type: 'subagent', id, state: 'running', label, action: block.name });
        const exec = executors[block.name];
        try {
          const out = await exec(block.input, { emit: () => {}, toolUseId: block.id, signal, requestConfirmation: async () => false });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: out.text, is_error: !out.ok });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `ผิดพลาด: ${e.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    emit({ type: 'subagent', id, state: 'done', label, summary: 'ถึงขีดจำกัดรอบการทำงาน' });
    return 'sub-agent ทำงานถึงขีดจำกัดรอบแล้ว โปรดแบ่งงานให้ย่อยลง';
  } catch (e) {
    emit({ type: 'subagent', id, state: 'error', label, summary: e.message });
    return `sub-agent ผิดพลาด: ${e.message}`;
  }
}

export function dispatchSubagentTool(client, emit, signal) {
  return {
    schema: {
      name: 'dispatch_subagent',
      description: 'มอบหมายงานย่อยที่ชัดเจนให้ sub-agent ทำแบบขนาน (เช่น สำรวจโค้ดส่วนหนึ่ง สรุปไฟล์ หาข้อมูล) sub-agent มีเครื่องมืออ่านอย่างเดียวและจะรายงานผลกลับมา ใช้เมื่อต้องการแตกงานออกเป็นส่วน ๆ',
      input_schema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'เป้าหมายของงานย่อยที่ต้องทำให้เสร็จในตัวเอง' },
          context: { type: 'string', description: 'บริบท/ข้อจำกัดเพิ่มเติมสำหรับ sub-agent (ถ้ามี)' },
        },
        required: ['goal'],
      },
    },
    async exec(input, ctx) {
      const text = await runSubagent({ client, goal: input.goal, context: input.context, emit, signal });
      ctx.emit({ type: 'tool_result', id: ctx.toolUseId, name: 'dispatch_subagent', ok: true, summary: 'sub-agent รายงานผลแล้ว' });
      return { ok: true, text };
    },
  };
}
