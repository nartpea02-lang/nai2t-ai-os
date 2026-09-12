/* NAI2T AI OS — App Shell
 * Boots any of the three apps: builds nav + drawer, renders the fullscreen
 * AI-assistant home, and wires avatar + voice + assistant brain + live
 * agent-dispatch visualization. Operational views are injected by each page.
 */
(function (global) {
  'use strict';

  const APPS = [
    { id: 'hq',    label: 'HQ',    href: '../hq/' },
    { id: 'atlas', label: 'Atlas', href: '../atlas/' },
    { id: 'nova',  label: 'Nova',  href: '../nova/' },
  ];

  function h(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function now() {
    return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  const ICONS = {
    menu: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    mic: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-3-6-7-2z"/></svg>',
    sound: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4zM17 8a5 5 0 0 1 0 8"/></svg>',
  };

  const NAIApp = {
    cfg: null,
    avatar: null,
    voice: null,
    brain: null,
    els: {},
    voiceMode: true,

    boot(cfg) {
      this.cfg = cfg;
      document.body.dataset.app = cfg.persona;
      this._buildChrome();
      this._buildAssistantView();
      this._wire();
      this._showView('assistant');
      // greet
      const g = this.brain.greeting();
      this._pushAI(g.text);
      setTimeout(() => this._speak(g.text), 400);
    },

    // ── Nav + Drawer ────────────────────────────
    _buildChrome() {
      const cfg = this.cfg;
      const nav = h('nav', 'nav');
      nav.setAttribute('aria-label', 'หลัก');
      const logo = h('a', 'nav-logo', 'NAI2T');
      logo.href = '../';
      logo.title = 'กลับหน้าแรก NAI2T';
      nav.appendChild(logo);
      nav.appendChild(h('div', 'nav-divider'));
      const links = h('div', 'nav-links');
      APPS.forEach(a => {
        const link = h('a', 'nav-link' + (a.id === cfg.persona ? ' active' : ''));
        link.href = a.href;
        link.dataset.app = a.id;
        link.innerHTML = `<span class="dot"></span>${a.label}`;
        links.appendChild(link);
      });
      nav.appendChild(links);
      const actions = h('div', 'nav-actions');
      const menuBtn = h('button', 'nav-icon-btn', ICONS.menu);
      menuBtn.setAttribute('aria-label', 'เมนู');
      menuBtn.dataset.testid = 'menu-btn';
      actions.appendChild(menuBtn);
      nav.appendChild(actions);
      document.body.appendChild(nav);

      // Drawer
      const overlay = h('div', 'drawer-overlay');
      const drawer = h('aside', 'drawer');
      drawer.setAttribute('aria-label', 'เมนูหน่วยงาน');
      const dh = h('div', 'drawer-header');
      dh.appendChild(h('div', 'drawer-title', `${cfg.title}`));
      const closeBtn = h('button', 'drawer-close', ICONS.close);
      closeBtn.setAttribute('aria-label', 'ปิด');
      dh.appendChild(closeBtn);
      drawer.appendChild(dh);

      drawer.appendChild(h('div', 'drawer-section', 'หน้าจอ'));
      const views = [{ id: 'assistant', label: 'ผู้ช่วย AI', icon: '✦' }].concat(cfg.views || []);
      views.forEach(v => {
        const item = h('div', 'drawer-item' + (v.id === 'assistant' ? ' active' : ''));
        item.dataset.view = v.id;
        item.innerHTML = `<span class="icon">${v.icon || '›'}</span>${v.label}`;
        drawer.appendChild(item);
      });

      drawer.appendChild(h('div', 'drawer-section', 'หน่วยงาน'));
      APPS.forEach(a => {
        const item = h('a', 'drawer-item' + (a.id === cfg.persona ? ' active' : ''));
        item.href = a.href;
        item.innerHTML = `<span class="icon">${a.id === 'hq' ? '◆' : a.id === 'atlas' ? '⬡' : '✺'}</span>${a.label}`;
        drawer.appendChild(item);
      });
      drawer.appendChild(h('div', 'drawer-section', 'เว็บไซต์'));
      const home = h('a', 'drawer-item');
      home.href = '../';
      home.innerHTML = '<span class="icon">⌂</span>หน้าแรก NAI2T';
      drawer.appendChild(home);

      document.body.appendChild(overlay);
      document.body.appendChild(drawer);

      const open = () => { overlay.classList.add('open'); drawer.classList.add('open'); };
      const close = () => { overlay.classList.remove('open'); drawer.classList.remove('open'); };
      menuBtn.onclick = open;
      closeBtn.onclick = close;
      overlay.onclick = close;
      drawer.querySelectorAll('[data-view]').forEach(el => {
        el.onclick = () => { this._showView(el.dataset.view); close(); };
      });
      this.els.drawer = drawer;
    },

    _showView(id) {
      document.querySelectorAll('[data-view-panel]').forEach(p => {
        p.hidden = p.dataset.viewPanel !== id;
      });
      if (this.els.drawer) {
        this.els.drawer.querySelectorAll('[data-view]').forEach(el =>
          el.classList.toggle('active', el.dataset.view === id));
      }
      if (this.cfg.onView) this.cfg.onView(id);
    },

    // ── Assistant (AI home) view ────────────────
    _buildAssistantView() {
      const cfg = this.cfg;
      let host = document.querySelector('[data-view-panel="assistant"]');
      if (!host) {
        host = h('section');
        host.dataset.viewPanel = 'assistant';
        document.body.appendChild(host);
      }
      host.classList.add('assistant-stage');
      host.innerHTML = `
        <div class="stage-grid">
          <div class="stage-main">
            <div class="avatar-halo">
              <div class="avatar-wrap" id="avatarMount" data-testid="avatar"></div>
            </div>
            <div class="persona-block">
              <h1 class="persona-name">${cfg.assistantName}</h1>
              <p class="persona-status" id="personaStatus">${cfg.tagline}</p>
            </div>
            <div class="conversation" id="conversation" data-testid="conversation" aria-live="polite"></div>
            <div class="voice-dock">
              <button class="mic-btn" id="micBtn" data-testid="mic-btn" aria-label="กดเพื่อพูด">${ICONS.mic}</button>
              <div class="chat-input-wrap">
                <input class="chat-input" id="chatInput" data-testid="chat-input" placeholder="พิมพ์ หรือกดไมค์เพื่อพูด…" autocomplete="off" />
                <button class="send-btn" id="sendBtn" data-testid="send-btn" aria-label="ส่ง">${ICONS.send}</button>
              </div>
              <button class="nav-icon-btn" id="muteBtn" aria-label="เสียงพูด" title="สลับเสียงพูด">${ICONS.sound}</button>
            </div>
          </div>
          <aside class="dispatch-panel" id="dispatchPanel" data-testid="dispatch-panel">
            <div class="dispatch-head">
              <span class="section-label">การมอบหมายงานสด</span>
            </div>
            <div class="dispatch-stage" id="dispatchStage">
              <div class="empty-state"><span class="icon">◇</span><p>เมื่อสั่งมอบหมายงาน จะเห็นเส้นทางการส่งงานจริงจากข้อมูลในระบบที่นี่</p></div>
            </div>
          </aside>
        </div>
      `;
      this.els.conversation = host.querySelector('#conversation');
      this.els.status = host.querySelector('#personaStatus');
      this.els.mic = host.querySelector('#micBtn');
      this.els.input = host.querySelector('#chatInput');
      this.els.send = host.querySelector('#sendBtn');
      this.els.mute = host.querySelector('#muteBtn');
      this.els.dispatchStage = host.querySelector('#dispatchStage');

      // transcript + mode badges (fixed)
      this.els.transcript = h('div', 'transcript-bar');
      this.els.transcript.dataset.testid = 'transcript';
      document.body.appendChild(this.els.transcript);
      this.els.modeBadge = h('div', 'mode-badge', '◐ สำเนียงใต้');
      document.body.appendChild(this.els.modeBadge);
      if (NAIData.getDialect() === 'south') this.els.modeBadge.classList.add('visible');
    },

    // ── Wire behaviour ──────────────────────────
    _wire() {
      const cfg = this.cfg;
      this.avatar = new global.NAIAvatar('#avatarMount', { persona: cfg.persona });
      this.brain = new global.NAIAssistant(cfg.persona);
      this.voice = new global.NAIVoice({
        lang: 'th-TH',
        onStart: () => { this.avatar.setState('listening'); this.els.mic.classList.add('listening'); this._setStatus('กำลังฟัง…'); },
        onEnd: () => { this.els.mic.classList.remove('listening'); if (!this.voice.speaking) this.avatar.setState('idle'); this._hideTranscript(); },
        onInterim: (t) => this._showTranscript(t, false),
        onResult: (t) => { this._showTranscript(t, true); this._submit(t); },
        onSpeakStart: () => { this.avatar.setState('speaking'); this.els.mic.classList.add('speaking'); },
        onSpeakEnd: () => { this.els.mic.classList.remove('speaking'); this.avatar.setState('idle'); this._setStatus(cfg.tagline); },
        onAmplitude: (a) => this.avatar.setMouthAmplitude(a),
        onError: () => { this.els.mic.classList.remove('listening'); this._setStatus('ไม่สามารถฟังได้ ลองพิมพ์แทนได้ครับ'); },
      });

      if (!this.voice.supported.recog) {
        this.els.mic.title = 'เบราว์เซอร์นี้ยังไม่รองรับการฟังเสียง — พิมพ์ได้เลย';
        this.els.mic.classList.add('unsupported');
      }

      this.els.mic.onclick = () => {
        if (this.voice.speaking) { this.voice.stopSpeaking(); return; }
        if (this.voice.listening) this.voice.stopListening();
        else this.voice.startListening();
      };
      const doSend = () => {
        const v = this.els.input.value.trim();
        if (!v) return;
        this.els.input.value = '';
        this._submit(v);
      };
      this.els.send.onclick = doSend;
      this.els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
      this.els.mute.onclick = () => {
        this.voiceMode = !this.voiceMode;
        this.els.mute.style.opacity = this.voiceMode ? '1' : '0.35';
        if (!this.voiceMode) this.voice.stopSpeaking();
        this._toast(this.voiceMode ? 'เปิดเสียงพูด' : 'ปิดเสียงพูด (โหมดข้อความ)');
      };
    },

    _submit(text) {
      this._pushUser(text);
      this.avatar.setState('thinking');
      this._setStatus('กำลังคิด…');
      // If a live agent backend is connected, route the turn to it instead of the offline brain.
      if (this.live && this.live.connected) { this.live.send(text); return; }
      setTimeout(() => {
        const res = this.brain.handle(text);
        this._pushAI(res.text);
        if (res.dialect === 'south') this.els.modeBadge.classList.add('visible');
        if (res.dialect === 'central') this.els.modeBadge.classList.remove('visible');
        if (res.dispatch) this._visualizeDispatch(res.dispatch);
        if (res.nav) { setTimeout(() => { location.href = '../' + res.nav + '/'; }, 900); }
        this._speak(res.text);
      }, 520);
    },

    _speak(text) {
      if (!this.voiceMode) { this.avatar.setState('happy'); setTimeout(() => this.avatar.setState('idle'), 1200); return; }
      this.voice.speak(text, { dialect: NAIData.getDialect() === 'south' ? 'south' : 'central' });
    },

    // ── Conversation UI ─────────────────────────
    _pushUser(text) { this._push('user', text); },
    _pushAI(text) { this._push('ai', text); },
    _push(who, text) {
      const msg = h('div', 'msg msg-' + who);
      const bubble = h('div', 'msg-bubble', this._esc(text));
      msg.appendChild(bubble);
      msg.appendChild(h('div', 'msg-time', now()));
      this.els.conversation.appendChild(msg);
      this.els.conversation.scrollTop = this.els.conversation.scrollHeight;
      // keep it light
      while (this.els.conversation.children.length > 30) this.els.conversation.removeChild(this.els.conversation.firstChild);
      return bubble;
    },

    // Public helpers for the live client (assets/js/luzy-live.js):
    pushUser(text) { return this._push('user', text); },
    pushAI(text) { return this._push('ai', text); },
    setStatus(text) { this._setStatus(text); },
    setAvatar(state) { this.avatar.setState(state); },
    scrollConversation() { this.els.conversation.scrollTop = this.els.conversation.scrollHeight; },

    _setStatus(t) { if (this.els.status) this.els.status.textContent = t; },
    _showTranscript(t, done) {
      this.els.transcript.innerHTML = done ? `<em>${this._esc(t)}</em>` : this._esc(t);
      this.els.transcript.classList.add('visible');
    },
    _hideTranscript() { setTimeout(() => this.els.transcript.classList.remove('visible'), 600); },

    // ── Agent-dispatch visualization (real data) ─
    _visualizeDispatch(d) {
      const stage = this.els.dispatchStage;
      const unitColor = { hq: 'var(--hq-5)', atlas: 'var(--atlas-5)', nova: 'var(--nova-5)' };
      const card = h('div', 'dispatch-flow');
      card.innerHTML = `
        <div class="df-node df-from">
          <div class="df-orb" style="--c:${unitColor[d.fromUnit]}">✦</div>
          <div class="df-name">${this._esc(d.from)}</div>
          <div class="df-sub">${d.fromUnit.toUpperCase()}</div>
        </div>
        <div class="df-link"><span class="df-pulse"></span></div>
        <div class="df-node df-to">
          <div class="df-orb" style="--c:${unitColor[d.toUnit]}">${this._esc(d.to.slice(0,1))}</div>
          <div class="df-name">${this._esc(d.to)}</div>
          <div class="df-sub">${this._esc(d.toRole)}</div>
        </div>
        <div class="df-task">
          <span class="badge badge-info">มอบหมาย</span>
          <span class="df-task-title">${this._esc(d.title)}</span>
        </div>`;
      // clear empty state on first dispatch
      const empty = stage.querySelector('.empty-state');
      if (empty) stage.innerHTML = '';
      stage.insertBefore(card, stage.firstChild);
      requestAnimationFrame(() => card.classList.add('run'));
      while (stage.children.length > 4) stage.removeChild(stage.lastChild);
    },

    _toast(text) {
      let t = document.querySelector('.toast');
      if (!t) { t = h('div', 'toast'); document.body.appendChild(t); }
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), 1800);
    },

    _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
  };

  global.NAIApp = NAIApp;
})(window);
