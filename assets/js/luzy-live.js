/* NAI2T · Luzy Live client
 * Connects the static frontend to the Luzy agentic backend over WebSocket.
 * Degrades gracefully: with no backend (or an unreachable one) the Terminal and
 * sub-agent features show "unavailable" and the offline assistant keeps working.
 */
(function (global) {
  'use strict';

  function h(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };

  const STATE_MAP = { thinking: 'thinking', planning: 'thinking', running: 'thinking', speaking: 'speaking', idle: 'idle' };

  const Live = {
    app: null, ws: null, url: '', connected: false, streamBubble: null,
    term: null, feed: null, chip: null,

    init(app, url) {
      this.app = app;
      this.url = (url || '').trim();
      this._mountUI();
      if (!this.url) { this._unavailable('ยังไม่ได้ตั้งค่า backend — ใช้งานโหมดออฟไลน์'); return; }
      this._connect();
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
          <span class="live-chip" id="liveChip" data-testid="live-chip">◌ ออฟไลน์</span>
        </div>
        <pre class="terminal-log" id="terminalLog" data-testid="terminal-log"></pre>`;
      this.term = host.querySelector('#terminalLog');
      this.chip = host.querySelector('#liveChip');
      // Reuse the assistant view's dispatch stage as the live sub-agent feed.
      this.feed = document.getElementById('dispatchStage');
    },

    _connect() {
      this._line('· กำลังเชื่อมต่อ ' + this.url, 'dim');
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this._unavailable('เชื่อมต่อ backend ไม่ได้ — โหมดออฟไลน์'); return; }
      this.ws = ws;
      const failIfUnopened = setTimeout(() => { if (!this.connected) { try { ws.close(); } catch (e) {} } }, 6000);

      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this._on(m); };
      ws.onclose = () => {
        clearTimeout(failIfUnopened);
        if (!this.connected) this._unavailable('เชื่อมต่อ backend ไม่ได้ — โหมดออฟไลน์');
        else { this._setChip('◌ หลุดการเชื่อมต่อ', false); this.connected = false; if (this.app) this.app.live = null; }
      };
      ws.onerror = () => { /* onclose handles fallback */ };
    },

    _unavailable(msg) {
      this.connected = false;
      if (this.app) this.app.live = null;         // offline brain stays in control
      this._setChip('◌ ออฟไลน์', false);
      this._line('· ' + msg, 'dim');
    },

    _on(m) {
      const app = this.app;
      switch (m.type) {
        case 'ready':
          this.connected = true;
          app.live = { connected: true, send: (t) => this._send(t) };
          this._setChip('● เชื่อมต่อแล้ว', true);
          this._line('● Luzy live พร้อมทำงาน (' + esc(m.model || '') + ')', 'ok');
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
          if (m.name === 'run_command') this._line('$ ' + (m.input && m.input.command || ''), 'cmd');
          else this._line('⚙ ' + m.name + ' ' + this._brief(m.input), 'tool');
          break;
        case 'tool_output_delta':
          this._append(m.chunk);
          break;
        case 'tool_result':
          this._line('  → ' + (m.ok ? '✓' : '✗') + ' ' + esc(m.summary || ''), m.ok ? 'dim' : 'err');
          break;
        case 'subagent':
          this._subagent(m);
          break;
        case 'confirm_required':
          this._confirm(m);
          break;
        case 'error':
          app.pushAI('⚠️ ' + m.message);
          this._line('✗ ' + esc(m.message), 'err');
          app.setAvatar('idle');
          break;
        case 'done':
          app.setAvatar('idle');
          this.streamBubble = null;
          break;
      }
    },

    _send(text) {
      this.streamBubble = null;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'user_message', text }));
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
