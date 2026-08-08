/* NAI2T AI OS — System Data Store
 * Single source of truth for all three units. Persists to localStorage so the
 * agent-dispatch visualization operates on real, mutable records — never mocks.
 */
(function (global) {
  'use strict';

  const KEY = 'nai2t.os.v3';

  const SEED = {
    units: {
      hq:    { id: 'hq',    name: 'HQ',    assistant: 'Luzy', tagline: 'ศูนย์บัญชาการ' },
      atlas: { id: 'atlas', name: 'Atlas', assistant: 'Atlas', tagline: 'งานสนาม' },
      nova:  { id: 'nova',  name: 'Nova',  assistant: 'Nova',  tagline: 'คอนเทนต์ & การตลาด' },
    },
    members: [
      { id: 'm1', name: 'ปกรณ์', role: 'ผู้อำนวยการ', unit: 'hq',    load: 2 },
      { id: 'm2', name: 'สุดา',  role: 'ผู้จัดการฝ่าย', unit: 'hq',    load: 3 },
      { id: 'm3', name: 'ช่างเอก', role: 'หัวหน้าช่างสนาม', unit: 'atlas', load: 4 },
      { id: 'm4', name: 'ช่างบี', role: 'ช่างติดตั้ง',   unit: 'atlas', load: 2 },
      { id: 'm5', name: 'ช่างซี', role: 'ช่างไฟฟ้า',     unit: 'atlas', load: 1 },
      { id: 'm6', name: 'มายด์',  role: 'ครีเอเตอร์',    unit: 'nova',  load: 3 },
      { id: 'm7', name: 'ต้นน้ำ', role: 'กราฟิกดีไซเนอร์', unit: 'nova',  load: 2 },
    ],
    tasks: [
      { id: 't1', title: 'ติดตั้งระบบโซลาร์ บ้านคุณวิชัย', unit: 'atlas', status: 'doing',  assignee: 'm3', priority: 'high', due: '2026-08-06' },
      { id: 't2', title: 'สำรวจหน้างาน อ.ทุ่งสง',        unit: 'atlas', status: 'todo',   assignee: 'm4', priority: 'mid',  due: '2026-08-05' },
      { id: 't3', title: 'ตรวจรับงานเดินสายไฟ เฟส 2',    unit: 'atlas', status: 'review', assignee: 'm5', priority: 'mid',  due: '2026-08-04' },
      { id: 't4', title: 'ถ่ายคอนเทนต์รีวิวติดตั้งจริง',   unit: 'nova',  status: 'doing',  assignee: 'm6', priority: 'high', due: '2026-08-05' },
      { id: 't5', title: 'ออกแบบโพสต์โปรโมชั่นหน้าฝน',     unit: 'nova',  status: 'todo',   assignee: 'm7', priority: 'mid',  due: '2026-08-07' },
      { id: 't6', title: 'สรุปรายงานผลประกอบการเดือน ก.ค.', unit: 'hq',    status: 'review', assignee: 'm2', priority: 'high', due: '2026-08-04' },
    ],
    projects: [
      { id: 'p1', name: 'โซลาร์รูฟ บ้านคุณวิชัย', client: 'คุณวิชัย', progress: 62, value: 185000 },
      { id: 'p2', name: 'ระบบไฟโรงงาน ทุ่งสง',    client: 'บจก.ทุ่งสงพัฒนา', progress: 28, value: 540000 },
      { id: 'p3', name: 'ติดตั้งปั๊มน้ำโซลาร์ สวนยาง', client: 'คุณสมพร', progress: 90, value: 96000 },
    ],
    boq: [
      { id: 'b1', project: 'p1', item: 'แผงโซลาร์ 550W',        qty: 12, unit: 'แผง',  price: 4200 },
      { id: 'b2', project: 'p1', item: 'อินเวอร์เตอร์ 5kW',      qty: 1,  unit: 'ตัว',  price: 32000 },
      { id: 'b3', project: 'p1', item: 'โครงยึดอลูมิเนียม',       qty: 24, unit: 'เส้น', price: 850 },
      { id: 'b4', project: 'p1', item: 'สายไฟ DC + อุปกรณ์',     qty: 1,  unit: 'ชุด',  price: 18500 },
      { id: 'b5', project: 'p1', item: 'ค่าติดตั้ง + แรงงาน',     qty: 1,  unit: 'งาน',  price: 45000 },
    ],
    campaigns: [
      { id: 'c1', name: 'รีวิวติดตั้งจริง คุณวิชัย', channel: 'TikTok',   status: 'live',      date: '2026-08-05', reach: 12400 },
      { id: 'c2', name: 'โปรหน้าฝน ลด 15%',        channel: 'Facebook', status: 'scheduled', date: '2026-08-08', reach: 0 },
      { id: 'c3', name: 'สาระโซลาร์ EP.4',          channel: 'YouTube',  status: 'draft',     date: '2026-08-12', reach: 0 },
    ],
    events: [
      { date: '2026-08-05', title: 'ถ่ายคอนเทนต์ คุณวิชัย', unit: 'nova' },
      { date: '2026-08-08', title: 'โพสต์โปรหน้าฝน',       unit: 'nova' },
      { date: '2026-08-12', title: 'อัดคลิป EP.4',          unit: 'nova' },
      { date: '2026-08-06', title: 'ติดตั้งโซลาร์ (นัดลูกค้า)', unit: 'atlas' },
    ],
    dispatchLog: [],
    settings: { dialect: 'central' },
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  const Data = {
    _state: null,
    _subs: [],

    load() {
      if (this._state) return this._state;
      try {
        const raw = localStorage.getItem(KEY);
        this._state = raw ? JSON.parse(raw) : clone(SEED);
      } catch (e) { this._state = clone(SEED); }
      // merge any new seed keys forward
      for (const k in SEED) if (!(k in this._state)) this._state[k] = clone(SEED[k]);
      return this._state;
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this._state)); } catch (e) {}
      this._subs.forEach(fn => { try { fn(this._state); } catch (e) {} });
    },
    reset() { this._state = clone(SEED); this.save(); return this._state; },
    subscribe(fn) { this._subs.push(fn); return () => { this._subs = this._subs.filter(f => f !== fn); }; },

    // ── selectors ──────────────────────────────
    get(k) { return this.load()[k]; },
    membersOf(unit) { return this.load().members.filter(m => m.unit === unit); },
    tasksOf(unit) { return this.load().tasks.filter(t => t.unit === unit); },
    member(id) { return this.load().members.find(m => m.id === id) || null; },
    boqOf(projectId) { return this.load().boq.filter(b => b.project === projectId); },
    boqTotal(projectId) { return this.boqOf(projectId).reduce((s, b) => s + b.qty * b.price, 0); },

    // pick the least-loaded member of a unit for fair dispatch
    pickAssignee(unit) {
      const ms = this.membersOf(unit);
      if (!ms.length) return null;
      return ms.slice().sort((a, b) => a.load - b.load)[0];
    },

    // ── mutations ──────────────────────────────
    addTask(t) {
      const s = this.load();
      const task = Object.assign({ id: 't' + Date.now(), status: 'todo', priority: 'mid' }, t);
      s.tasks.push(task);
      const m = this.member(task.assignee);
      if (m) m.load += 1;
      this.save();
      return task;
    },
    moveTask(id, status) {
      const t = this.load().tasks.find(x => x.id === id);
      if (t) { t.status = status; this.save(); }
      return t;
    },
    logDispatch(entry) {
      const s = this.load();
      s.dispatchLog.unshift(Object.assign({ at: Date.now() }, entry));
      s.dispatchLog = s.dispatchLog.slice(0, 30);
      this.save();
    },
    setDialect(d) { this.load().settings.dialect = d; this.save(); },
    getDialect() { return this.load().settings.dialect; },
  };

  global.NAIData = Data;
})(window);
