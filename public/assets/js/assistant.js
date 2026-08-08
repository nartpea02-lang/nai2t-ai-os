/* NAI2T AI OS — Assistant Brain
 * Offline, rule-based intent engine (Thai + English). No network calls.
 * Produces { text, dispatch?, nav?, dialect? } from a user utterance, acting on
 * the real NAIData store so dispatches create actual tasks & assignments.
 */
(function (global) {
  'use strict';

  const D = global.NAIData;

  const PERSONA = {
    hq:    { name: 'Luzy', unit: 'hq',    domain: ['ทั้งหมด', 'ภาพรวม', 'องค์กร'] },
    atlas: { name: 'Atlas', unit: 'atlas', domain: ['ติดตั้ง', 'สนาม', 'ช่าง', 'สำรวจ', 'boq', 'งานหน้างาน'] },
    nova:  { name: 'Nova',  unit: 'nova',  domain: ['คอนเทนต์', 'โพสต์', 'แคมเปญ', 'ถ่าย', 'การตลาด', 'โฆษณา'] },
  };

  // decide which unit a free-text task belongs to
  function routeUnit(text) {
    const t = text.toLowerCase();
    if (/ติดตั้ง|สำรวจ|หน้างาน|ช่าง|เดินสาย|ไฟฟ้า|โซลาร์|boq|สนาม/.test(t)) return 'atlas';
    if (/คอนเทนต์|โพสต์|แคมเปญ|ถ่าย|คลิป|โฆษณา|การตลาด|รีวิว|กราฟิก/.test(t)) return 'nova';
    if (/รายงาน|สรุป|ประชุม|งบ|บัญชี|เอกสาร/.test(t)) return 'hq';
    return 'atlas';
  }

  // ── Southern (Nakhon Si Thammarat) flavour ──
  const SOUTH_MAP = [
    [/ครับ/g, 'เน้อ'],
    [/ค่ะ|คะ/g, 'เน้อ'],
    [/นะ(?=\s|$|เน้อ)/g, 'นิ'],
    [/มาก(?=\b|ๆ)/g, 'จังหู้'],
    [/ใช่ไหม/g, 'ไหมพี่น้อง'],
    [/อะไร/g, 'ไหร'],
    [/ทำไม/g, 'ไซ'],
    [/ไม่มี/g, 'ไม่มีดอก'],
    [/เรียบร้อย/g, 'เรียบร้อยแล้วเน้อ'],
  ];
  function southernize(text) {
    let t = text;
    SOUTH_MAP.forEach(([re, rep]) => { t = t.replace(re, rep); });
    if (!/เน้อ|จังหู้|โหลย/.test(t)) t = t.replace(/[.!?]?$/, ' เน้อ');
    return t;
  }

  class Assistant {
    constructor(persona) {
      this.p = PERSONA[persona] || PERSONA.hq;
    }

    greeting() {
      const hr = new Date().getHours();
      const part = hr < 11 ? 'สวัสดีตอนเช้า' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนค่ำ';
      const doing = D.tasksOf(this.p.unit).filter(t => t.status === 'doing').length;
      return this._out(`${part} ผมคือ ${this.p.name} ผู้ช่วยของ ${this.p.unit.toUpperCase()} ตอนนี้มีงานกำลังดำเนินการ ${doing} รายการ อยากให้ช่วยอะไรบอกได้เลย พูดหรือพิมพ์ก็ได้`);
    }

    // main entry — returns response object
    handle(rawText) {
      const text = (rawText || '').trim();
      if (!text) return this._out('ผมยังไม่ได้ยินอะไรเลย ลองพูดอีกครั้งได้ไหม');
      const t = text.toLowerCase();

      // dialect switch
      if (/พูดใต้|สำเนียงใต้|ภาษาใต้|โหมดใต้|แหลงใต้/.test(t)) {
        D.setDialect('south');
        return { text: southernize('เปลี่ยนเป็นสำเนียงใต้ให้แล้ว ต่อไปผมจะแหลงใต้กับพี่น้อง'), dialect: 'south' };
      }
      if (/พูดกลาง|สำเนียงกลาง|ภาษากลาง|โหมดปกติ|ภาษามาตรฐาน/.test(t)) {
        D.setDialect('central');
        return { text: 'กลับมาใช้สำเนียงกลางแล้วครับ', dialect: 'central' };
      }

      // navigation between apps
      if (/(ไป|เปิด|สลับ|เข้า).*(atlas|แอตลาส|งานสนาม)/.test(t)) return this._out('กำลังพาไปที่ Atlas ครับ', { nav: 'atlas' });
      if (/(ไป|เปิด|สลับ|เข้า).*(nova|โนวา|คอนเทนต์|การตลาด)/.test(t)) return this._out('กำลังพาไปที่ Nova ครับ', { nav: 'nova' });
      if (/(ไป|เปิด|สลับ|กลับ).*(hq|สำนักงาน|บัญชาการ|luzy|ลูซี่)/.test(t)) return this._out('กลับสู่ HQ ครับ', { nav: 'hq' });

      // help
      if (/ช่วยอะไรได้|ทำอะไรได้|help|คำสั่ง|เมนู/.test(t)) return this._help();

      // dispatch / assign — checked before team/status because assignment
      // utterances often contain "ทีม" (e.g. "มอบหมาย…ให้ทีมช่าง").
      if (/มอบหมาย|สั่งงาน|จ่ายงาน|assign|dispatch|ให้.*(ทำ|ไป)|เพิ่มงาน|สร้างงาน|ช่วย.*(ติดตั้ง|ถ่าย|ออกแบบ|สำรวจ)/.test(t)) {
        return this._dispatch(text);
      }

      // team roster (a pure question, not an assignment)
      if (/ทีม|ใครบ้าง|สมาชิก|พนักงาน|กำลังพล/.test(t)) return this._team();

      // status / report
      if (/สถานะ|รายงาน|สรุป|ภาพรวม|คืบหน้า|อัปเดต|report|status/.test(t)) return this._status();

      // thanks
      if (/ขอบคุณ|ขอบใจ|เยี่ยม|เก่ง|thanks|thank you/.test(t)) return this._out('ยินดีเสมอครับ มีอะไรเรียกผมได้ตลอด');

      // fallback — treat as a task to dispatch if it looks like work, else clarify
      if (text.length > 6 && /[ก-๙]/.test(text)) return this._dispatch(text);
      return this._out('ผมยังไม่แน่ใจว่าต้องการให้ทำอะไร ลองบอกเช่น "มอบหมายงานติดตั้งให้ทีมช่าง" หรือถาม "สรุปสถานะงาน" ก็ได้ครับ');
    }

    _dispatch(text) {
      const unit = this.p.unit === 'hq' ? routeUnit(text) : this.p.unit;
      const assignee = D.pickAssignee(unit);
      if (!assignee) return this._out('ยังไม่มีสมาชิกในหน่วยนี้ให้มอบหมายครับ');

      // clean a task title out of the utterance
      let title = text
        .replace(/(มอบหมาย|สั่งงาน|จ่ายงาน|assign|dispatch|ช่วย|หน่อย|ให้ที|ให้.*?(ทีม|ช่าง|คน)?)/g, '')
        .replace(/\s+/g, ' ').trim();
      if (title.length < 4) title = text.trim();

      const task = D.addTask({ title, unit, assignee: assignee.id, priority: /ด่วน|เร่ง|high|สำคัญ/.test(text) ? 'high' : 'mid' });
      D.logDispatch({ from: this.p.name, to: assignee.name, unit, title });

      const dispatch = {
        from: this.p.name,
        fromUnit: this.p.unit,
        to: assignee.name,
        toRole: assignee.role,
        toUnit: unit,
        taskId: task.id,
        title,
      };
      const unitName = D.get('units')[unit].name;
      return this._out(`รับทราบครับ ผมมอบหมาย "${title}" ให้ ${assignee.name} (${assignee.role}) ทีม ${unitName} เรียบร้อย งานถูกเพิ่มเข้าระบบและอัปเดตภาระงานให้แล้ว`, { dispatch });
    }

    _status() {
      const scope = this.p.unit === 'hq' ? null : this.p.unit;
      const tasks = scope ? D.tasksOf(scope) : D.get('tasks');
      const doing = tasks.filter(t => t.status === 'doing').length;
      const todo = tasks.filter(t => t.status === 'todo').length;
      const review = tasks.filter(t => t.status === 'review').length;
      let extra = '';
      if (this.p.unit === 'atlas' || this.p.unit === 'hq') {
        const proj = D.get('projects');
        const avg = Math.round(proj.reduce((s, p) => s + p.progress, 0) / proj.length);
        extra = ` โครงการติดตั้ง ${proj.length} งาน คืบหน้าเฉลี่ย ${avg}%`;
      }
      if (this.p.unit === 'nova') {
        const live = D.get('campaigns').filter(c => c.status === 'live').length;
        extra = ` แคมเปญที่กำลังออนไลน์ ${live} รายการ`;
      }
      return this._out(`สรุปสถานะ${scope ? ' ' + D.get('units')[scope].name : 'ภาพรวมทั้งองค์กร'} — กำลังทำ ${doing} งาน, รอเริ่ม ${todo} งาน, รอตรวจ ${review} งาน.${extra} ต้องการให้เปิดหน้ารายละเอียดไหมครับ`);
    }

    _team() {
      const scope = this.p.unit === 'hq' ? null : this.p.unit;
      const ms = scope ? D.membersOf(scope) : D.get('members');
      const names = ms.map(m => `${m.name} (${m.role})`).join(', ');
      return this._out(`ทีม${scope ? ' ' + D.get('units')[scope].name : 'ทั้งหมด'} มี ${ms.length} คน: ${names}`);
    }

    _help() {
      return this._out(`ผมช่วยได้หลายอย่างครับ เช่น — "มอบหมายงานติดตั้งให้ทีมช่าง", "สรุปสถานะงาน", "ทีมมีใครบ้าง", "เปิด Atlas / Nova", หรือสั่ง "พูดใต้" เพื่อสลับสำเนียง. พูดหรือพิมพ์ก็ได้ทั้งนั้น`);
    }

    _out(text, extra = {}) {
      const dialect = D.getDialect();
      const finalText = dialect === 'south' ? southernize(text) : text;
      return Object.assign({ text: finalText, dialect }, extra);
    }
  }

  global.NAIAssistant = Assistant;
  global.NAISouthernize = southernize;
})(window);
