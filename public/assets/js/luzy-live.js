/* NAI2T · Luzy Live client
 * Connects the static frontend to the Luzy agentic backend over WebSocket.
 * Degrades gracefully: with no backend (or an unreachable one) the Terminal and
 * sub-agent features show "unavailable" and the offline assistant keeps working.
 *
 * The backend URL is resolved at runtime — ?backend= wins, then whatever the
 * operator saved from the Terminal panel, then the page's window.NAI2T_BACKEND.
 * Pointing a deployed site at a backend therefore needs no rebuild.
 */
(function (global) {
  'use strict';

  const STORE_KEY = 'nai2t.backend';
  const PING_MS = 25000;          // app-level keepalive (Render idles out silent sockets)
  const STALE_MS = 60000;         // no traffic for this long => the socket is dead
  const BACKOFF = [1000, 2000, 4000, 8000, 15000];

  function h(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };

  function store(key, val) {
    try {
      if (val === undefined) return global.localStorage.getItem(key) || '';
      if (val === null) { global.localStorage.removeItem(key); return ''; }
      global.localStorage.setItem(key, val);
      return val;
    } catch (e) { return ''; }        // private mode / storage disabled
  }

  const STATE_MAP = { thinking: 'thinking', planning: 'thinking', running: 'thinking', speaking: 'speaking', idle: 'idle' };

  const Live = {
    app: null, ws: null, url: '', connected: false, streamBubble: null,
    term: null, feed: null, chip: null, els: {},
    attempt: 0, retryT: null, pingT: null, lastRx: 0, everConnected: false, busy: false,

    /* Accepts anything an operator is likely to paste — a bare host, an https://
       service URL, or a full wss://…/ws — and returns a WebSocket URL. */
    normalizeUrl(raw) {
      let s = String(raw == null ? '' : raw).trim();
      if (!s) return '';
      if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
      else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
      else if (!/^wss?:\/\//i.test(s)) s = (global.location.protocol === 'https:' ? 'wss://' : 'ws://') + s;
      let u;
      try { u = new URL(s); } catch (e) { return ''; }
      if (u.pathname === '/' || u.pathname === '') u.pathname = '/ws';
      return u.toString();
    },

    /* ws://host/ws -> http://host/health — used for a pre-flight diagnosis. */
    healthUrl(wsUrl) {
      try {
        const u = new URL(wsUrl);
        u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
        u.pathname = u.pathname.replace(/\/ws\/?$/, '') + '/health';
        return u.toString();
      } catch (e) { return ''; }
    },

    resolveUrl(explicit) {
      let fromQuery = '';
      try { fromQuery = new URLSearchParams(global.location.search).get('backend') || ''; } catch (e) {}
      if (fromQuery) store(STORE_KEY, fromQuery);        // sticky across navigation
      return (explicit || fromQuery || store(STORE_KEY) || global.NAI2T_BACKEND || '').trim();
    },

    init(app, url) {
      this.app = app;
      this._mountUI();
      this.connectTo(this.resolveUrl(url), { silent: true });
    },

    connectTo(raw, opts) {
      this._teardown();
      const wanted = (raw || '').trim();
      if (this.els.input) this.els.input.value = wanted;
      if (!wanted) {
        this.url = '';
        this._unavailable('ยังไม่ได้ตั้งค่า backend — ใช้งานโหมดออฟไลน์');
        if (!(opts && opts.silent)) this._line('· วาง URL ของ backend ด้านบนแล้วกด "เชื่อมต่อ"', 'dim');
        return;
      }
      const url = this.normalizeUrl(wanted);
      if (!url) { this.url = ''; this._unavailable('URL ของ backend ไม่ถูกต้อง: ' + wanted); return; }
      if (global.location.protocol === 'https:' && url.startsWith('ws://')) {
        this.url = '';
        this._unavailable('หน้าเว็บเป็น HTTPS จึงต้องใช้ wss:// (ws:// จะถูกเบราว์เซอร์บล็อก)');
        return;
      }
      this.url = url;
      this.attempt = 0;
      this.everConnected = false;
      this._preflight(url);
      this._connect();
    },

    /* Non-blocking: /health tells the operator *why* a socket will fail
       (service asleep, key missing) but a CORS block here is not an error. */
    _preflight(url) {
      const hu = this.healthUrl(url);
      if (!hu || typeof global.fetch !== 'function') return;
      global.fetch(hu, { mode: 'cors' })
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) this._line('· /health ตอบกลับ: model ' + (j.model || '?') + (j.configured ? '' : ' — ⚠ ยังไม่ได้ตั้ง ANTHROPIC_API_KEY'), j.configured ? 'dim' : 'err');
        })
        .catch(() => { /* CORS or asleep — the socket attempt is the real test */ });
    },

    _mountUI() {
      // Terminal view panel (created if the page didn't declare one).
      let host = document.querySelector('[data-view-panel="terminal"]');
      if (!host) { host = h('section'); host.dataset.viewPanel = 'terminal'; host.hidden = true; document.body.appendChild(host); }
      host.classList.add('op-view');
      host.innerHTML = `
        <div class="op-header">
          <div>
            <div class="op-title">เทอร์มินัลสด · Luzy</div>
            <div class="op-sub">คำสั่งและผลลัพธ์จริงจาก agent — สตรีมแบบเรียลไทม์</div>
          </div>
          <div class="live-actions">
            <button class="btn btn-ghost live-stop" data-testid="stop-btn" hidden>■ หยุด</button>
            <span class="live-chip" id="liveChip" data-testid="live-chip">◌ ออฟไลน์</span>
          </div>
        </div>
        <div class="live-setup">
          <input class="live-input" data-testid="backend-url" spellcheck="false" autocomplete="off"
                 placeholder="wss://nai2t-luzy.onrender.com/ws" aria-label="URL ของ Luzy backend" />
          <button class="btn btn-primary" data-testid="backend-connect">เชื่อมต่อ</button>
          <button class="btn btn-ghost" data-testid="backend-clear">ล้าง</button>
        </div>
        <pre class="terminal-log" id="terminalLog" data-testid="terminal-log"></pre>`;
      this.term = host.querySelector('#terminalLog');
      this.chip = host.querySelector('#liveChip');
      this.els.input = host.querySelector('[data-testid="backend-url"]');
      this.els.stop = host.querySelector('[data-testid="stop-btn"]');
      host.querySelector('[data-testid="backend-connect"]').onclick = () => {
        const v = this.els.input.value.trim();
        store(STORE_KEY, v || null);
        this.connectTo(v);
      };
      host.querySelector('[data-testid="backend-clear"]').onclick = () => {
        store(STORE_KEY, null);
        this.els.input.value = '';
        this.connectTo('');
      };
      this.els.stop.onclick = () => this.interrupt();
      // Reuse the assistant view's dispatch stage as the live sub-agent feed.
      this.feed = document.getElementById('dispatchStage');
    },

    _connect() {
      this._line('· กำลังเชื่อมต่อ ' + this.url, 'dim');
      this._setChip('◌ กำลังเชื่อมต่อ', false);
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this._closed(null); return; }
      this.ws = ws;
      this.lastRx = Date.now();
      const failIfUnopened = setTimeout(() => { if (!this.connected) { try { ws.close(); } catch (e) {} } }, 8000);

      ws.onmessage = (ev) => {
        this.lastRx = Date.now();
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'pong') return;
        this._on(m);
      };
      ws.onclose = (ev) => {
        clearTimeout(failIfUnopened);
        if (this.ws !== ws) return;                    // superseded by a newer socket
        this._closed(ev);
      };
      ws.onerror = () => { /* onclose handles fallback */ };
      ws.onopen = () => { this._startHeartbeat(); };
    },

    _closed(ev) {
      this._stopHeartbeat();
      this.streamBubble = null;
      this._setBusy(false);
      const wasConnected = this.connected;
      this.connected = false;
      if (this.app) this.app.live = null;              // offline brain takes back over

      if (ev && ev.code === 1008) {                    // server rejected the origin
        this._setChip('◌ ถูกปฏิเสธ', false);
        this._line('✗ backend ปฏิเสธ origin นี้ — เพิ่ม ' + global.location.origin + ' ใน ALLOWED_ORIGINS แล้ว deploy ใหม่', 'err');
        return;
      }
      if (!wasConnected && !this.everConnected) {      // never got in: don't retry-storm
        this._unavailable('เชื่อมต่อ backend ไม่ได้ — โหมดออฟไลน์');
        this._offerRetry();
        return;
      }
      this._setChip('◌ หลุดการเชื่อมต่อ', false);
      this._scheduleReconnect();
    },

    _scheduleReconnect() {
      const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
      this.attempt += 1;
      if (this.attempt > BACKOFF.length) { this._unavailable('เชื่อมต่อใหม่ไม่สำเร็จ — โหมดออฟไลน์'); this._offerRetry(); return; }
      this._line('· เชื่อมต่อใหม่ใน ' + Math.round(delay / 1000) + ' วิ (ครั้งที่ ' + this.attempt + ')', 'dim');
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => { if (this.url) this._connect(); }, delay);
    },

    _offerRetry() {
      if (!this.term || !this.url) return;
      const row = h('div', 'term-line');
      const btn = h('button', 'btn btn-ghost live-retry', 'ลองเชื่อมต่อใหม่');
      btn.dataset.testid = 'retry-btn';
      btn.onclick = () => { row.remove(); this.attempt = 0; this._connect(); };
      row.appendChild(btn);
      this.term.appendChild(row);
      this.term.scrollTop = this.term.scrollHeight;
    },

    _startHeartbeat() {
      this._stopHeartbeat();
      this.pingT = setInterval(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastRx > STALE_MS) { try { this.ws.close(); } catch (e) {} return; }
        try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      }, PING_MS);
    },
    _stopHeartbeat() { clearInterval(this.pingT); this.pingT = null; },

    _teardown() {
      clearTimeout(this.retryT);
      this._stopHeartbeat();
      const ws = this.ws;
      this.ws = null;
      this.connected = false;
      if (this.app) this.app.live = null;
      if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} }
    },

    interrupt() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'interrupt' }));
      this._line('· ส่งคำสั่งหยุด', 'dim');
    },

    _unavailable(msg) {
      this.connected = false;
      if (this.app) this.app.live = null;         // offline brain stays in control
      this._setChip('◌ ออฟไลน์', false);
      this._setBusy(false);
      this._line('· ' + msg, 'dim');
    },

    _setBusy(on) {
      this.busy = !!on;
      if (this.els.stop) this.els.stop.hidden = !on;
    },

    _on(m) {
      const app = this.app;
      switch (m.type) {
        case 'ready':
          this.connected = true;
          this.everConnected = true;
          this.attempt = 0;
          app.live = { connected: true, send: (t) => this._send(t), interrupt: () => this.interrupt() };
          this._setChip('● เชื่อมต่อแล้ว', true);
          this._line('● Luzy live พร้อมทำงาน (' + (m.model || '') + ')', 'ok');
          break;
        case 'status':
          app.setAvatar(STATE_MAP[m.state] || 'idle');
          if (m.label) app.setStatus(m.label);
          break;
        case 'thinking_delta':
          app.setStatus('กำลังคิด…');
          break;
        case 'assistant_delta':
          if (!this.streamBubble) { this.streamBubble = app.pushAI(''); }
          this.streamBubble.textContent += m.text;
          app.scrollConversation();
          break;
        case 'assistant':
          if (this.streamBubble) { this.streamBubble = null; }
          else if (m.text) app.pushAI(m.text);
          break;
        case 'tool_call':
          this.streamBubble = null;
          if (m.name === 'run_command') {
            // Only log the command once it is actually running — the first
            // tool_call arrives before any confirmation prompt, so echoing it
            // there would imply the command already ran.
            if (m.running) this._line('$ ' + (m.input && m.input.command || ''), 'cmd');
          } else {
            this._line('⚙ ' + m.name + ' ' + this._brief(m.input), 'tool');
          }
          break;
        case 'tool_output_delta':
          this._append(m.chunk);
          break;
        case 'tool_result':
          this._line('  → ' + (m.ok ? '✓' : '✗') + ' ' + (m.summary || ''), m.ok ? 'dim' : 'err');
          break;
        case 'subagent':
          this._subagent(m);
          break;
        case 'confirm_required':
          this._confirm(m);
          break;
        case 'error':
          app.pushAI('⚠️ ' + m.message);
          this._line('✗ ' + m.message, 'err');
          app.setAvatar('idle');
          this._setBusy(false);
          break;
        case 'done':
          app.setAvatar('idle');
          this.streamBubble = null;
          this._setBusy(false);
          break;
      }
    },

    _send(text) {
      this.streamBubble = null;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._setBusy(true);
        this.ws.send(JSON.stringify({ type: 'user_message', text }));
      }
    },

    _brief(input) { try { const s = JSON.stringify(input); return s.length > 60 ? s.slice(0, 60) + '…' : s; } catch (e) { return ''; } },

    _line(text, cls) {
      if (!this.term) return;
      const span = h('div', 'term-line' + (cls ? ' term-' + cls : ''));
      span.textContent = text;
      this.term.appendChild(span);
      this.term.scrollTop = this.term.scrollHeight;
      while (this.term.children.length > 400) this.term.removeChild(this.term.firstChild);
    },
    _append(chunk) {
      if (!this.term) return;
      let last = this.term.lastElementChild;
      if (!last || !last.classList.contains('term-out')) { last = h('div', 'term-line term-out'); this.term.appendChild(last); }
      last.textContent += chunk;
      this.term.scrollTop = this.term.scrollHeight;
    },

    _subagent(m) {
      if (!this.feed) return;
      const empty = this.feed.querySelector('.empty-state');
      if (empty) this.feed.innerHTML = '';
      let card = this.feed.querySelector('[data-sa="' + m.id + '"]');
      if (!card) {
        card = h('div', 'sa-card');
        card.dataset.sa = m.id;
        card.innerHTML = `<div class="sa-head"><span class="sa-dot"></span><span class="sa-label"></span></div><div class="sa-state"></div>`;
        this.feed.insertBefore(card, this.feed.firstChild);
        while (this.feed.children.length > 5) this.feed.removeChild(this.feed.lastChild);
      }
      card.querySelector('.sa-label').textContent = m.label || 'sub-agent';
      const labels = { planning: 'กำลังวางแผน', thinking: 'กำลังคิด', running: 'กำลังทำงาน' + (m.action ? ' · ' + m.action : ''), done: '✓ เสร็จ', error: '✗ ผิดพลาด' };
      card.querySelector('.sa-state').textContent = labels[m.state] || m.state;
      card.className = 'sa-card sa-' + m.state;
    },

    _confirm(m) {
      const app = this.app;
      const wrap = h('div', 'msg msg-ai');
      const card = h('div', 'confirm-card');
      card.innerHTML =
        `<div class="confirm-reason">🔒 ${esc(m.reason || 'ยืนยันคำสั่ง')}</div>` +
        `<code class="confirm-cmd">${esc(m.command)}</code>` +
        `<div class="confirm-actions"><button class="btn btn-ghost" data-act="deny">ยกเลิก</button>` +
        `<button class="btn btn-primary" data-act="allow" data-testid="confirm-allow">อนุมัติให้รัน</button></div>`;
      wrap.appendChild(card);
      app.els.conversation.appendChild(wrap);
      app.scrollConversation();
      const answer = (allow) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'confirm', id: m.id, allow }));
        card.querySelectorAll('button').forEach(b => b.disabled = true);
        card.classList.add(allow ? 'confirmed' : 'denied');
      };
      card.querySelector('[data-act="allow"]').onclick = () => answer(true);
      card.querySelector('[data-act="deny"]').onclick = () => answer(false);
    },

    _setChip(text, on) {
      if (!this.chip) return;
      this.chip.textContent = text;
      this.chip.classList.toggle('on', !!on);
    },
  };

  global.LuzyLive = Live;
})(window);
