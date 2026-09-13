/* NAI2T AI OS — Living Avatar
 * Pure SVG + CSS. No images, no network. Fully offline.
 * States: idle | listening | thinking | speaking | happy
 * Each assistant gets a hue so Luzy/Atlas/Nova feel distinct but one family.
 */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* NAI2T brand hues — HQ cyan (command), Atlas green (field), Nova orange (creative). */
  const PALETTES = {
    hq:    { core: '#6fd2ff', ring: '#3aa6e0', glow: '#1b4b7a', spark: '#a9e2ff' },
    atlas: { core: '#6fdcb6', ring: '#2fbf8f', glow: '#17714f', spark: '#a7f0d6' },
    nova:  { core: '#ffa346', ring: '#f2841f', glow: '#c25c08', spark: '#ffc489' },
  };

  class Avatar {
    constructor(mount, opts = {}) {
      this.mount = typeof mount === 'string' ? document.querySelector(mount) : mount;
      this.persona = opts.persona || 'hq';
      this.pal = PALETTES[this.persona] || PALETTES.hq;
      this.state = 'idle';
      this.mouthAmp = 0;         // 0..1 speaking amplitude
      this._blinkTimer = null;
      this._raf = null;
      this._t = 0;
      this._gazeX = 0; this._gazeY = 0;
      this._targetGazeX = 0; this._targetGazeY = 0;
      this._build();
      this._loop();
      this._scheduleBlink();
    }

    _build() {
      const uid = 'av' + Math.random().toString(36).slice(2, 8);
      const svg = el('svg', { viewBox: '0 0 200 200', class: 'nai-avatar', role: 'img', 'aria-label': 'NAI2T assistant' });
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.overflow = 'visible';

      const defs = el('defs');
      // Core radial gradient
      const grad = el('radialGradient', { id: uid + 'core', cx: '42%', cy: '38%', r: '75%' });
      grad.appendChild(el('stop', { offset: '0%', 'stop-color': this.pal.spark }));
      grad.appendChild(el('stop', { offset: '48%', 'stop-color': this.pal.core }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': this.pal.glow }));
      defs.appendChild(grad);
      // Soft blur for aura
      const blur = el('filter', { id: uid + 'blur', x: '-60%', y: '-60%', width: '220%', height: '220%' });
      blur.appendChild(el('feGaussianBlur', { stdDeviation: '10', in: 'SourceGraphic' }));
      defs.appendChild(blur);
      svg.appendChild(defs);

      // ── Aura rings (behind) ──────────────────────────
      this.auraOuter = el('circle', { cx: 100, cy: 100, r: 78, fill: 'none', stroke: this.pal.ring, 'stroke-width': 1.2, opacity: 0.18 });
      this.auraMid   = el('circle', { cx: 100, cy: 100, r: 64, fill: 'none', stroke: this.pal.ring, 'stroke-width': 1.5, opacity: 0.28 });
      svg.appendChild(this.auraOuter);
      svg.appendChild(this.auraMid);

      // Orbiting sparks (listening/thinking energy)
      this.sparkGroup = el('g');
      this.sparks = [];
      for (let i = 0; i < 3; i++) {
        const s = el('circle', { r: 2.6, fill: this.pal.spark, opacity: 0 });
        this.sparks.push(s);
        this.sparkGroup.appendChild(s);
      }
      svg.appendChild(this.sparkGroup);

      // ── Glow blob (breathing body) ───────────────────
      this.glow = el('circle', { cx: 100, cy: 100, r: 52, fill: this.pal.glow, opacity: 0.35, filter: `url(#${uid}blur)` });
      svg.appendChild(this.glow);

      // ── Face core group (scales for breathing) ───────
      this.faceG = el('g');
      this.core = el('circle', { cx: 100, cy: 100, r: 50, fill: `url(#${uid}core)` });
      this.faceG.appendChild(this.core);

      // Eyes group (translate for gaze)
      this.eyesG = el('g');
      const eyeY = 92;
      // Eye = rounded rect that we squash for blink
      this.eyeL = el('rect', { x: 80, y: eyeY - 9, width: 8, height: 18, rx: 4, fill: '#0a0a12', opacity: 0.92 });
      this.eyeR = el('rect', { x: 112, y: eyeY - 9, width: 8, height: 18, rx: 4, fill: '#0a0a12', opacity: 0.92 });
      // eye shine
      this.shineL = el('circle', { cx: 82.5, cy: eyeY - 3, r: 1.6, fill: '#fff', opacity: 0.85 });
      this.shineR = el('circle', { cx: 114.5, cy: eyeY - 3, r: 1.6, fill: '#fff', opacity: 0.85 });
      this.eyesG.appendChild(this.eyeL);
      this.eyesG.appendChild(this.eyeR);
      this.eyesG.appendChild(this.shineL);
      this.eyesG.appendChild(this.shineR);
      this.faceG.appendChild(this.eyesG);
      this._eyeY = eyeY;

      // Mouth (path we morph)
      this.mouth = el('path', { d: this._mouthPath(0, 0.15), fill: 'none', stroke: '#0a0a12', 'stroke-width': 4.5, 'stroke-linecap': 'round', opacity: 0.9 });
      this.faceG.appendChild(this.mouth);

      svg.appendChild(this.faceG);
      this.svg = svg;
      this._uid = uid;
      this.mount.appendChild(svg);
    }

    // curve: -1 frown .. 0 neutral .. 1 smile ; open: 0..1 mouth open (speaking)
    _mouthPath(curve, open) {
      const cx = 100, y = 118;
      const w = 24;
      const dip = curve * 10;         // smile lifts ends up (control below)
      const oy = open * 9;            // vertical opening
      const x0 = cx - w / 2, x1 = cx + w / 2;
      if (open > 0.06) {
        // open mouth: two arcs forming a lens
        const top = y - oy * 0.35;
        const bot = y + oy;
        return `M${x0} ${y} Q${cx} ${top - dip} ${x1} ${y} Q${cx} ${bot - dip} ${x0} ${y} Z`;
      }
      // closed: single quadratic; positive curve = smile
      const ctrlY = y + dip;
      return `M${x0} ${y - Math.max(0, dip) * 0.2} Q${cx} ${ctrlY} ${x1} ${y - Math.max(0, dip) * 0.2}`;
    }

    _scheduleBlink() {
      clearTimeout(this._blinkTimer);
      const next = 2200 + Math.random() * 3200;
      this._blinkTimer = setTimeout(() => {
        this._blink();
        this._scheduleBlink();
      }, next);
    }

    _blink() {
      if (this.state === 'listening') return; // eyes stay wide while listening
      const doSquash = (v) => {
        this.eyeL.setAttribute('height', v);
        this.eyeR.setAttribute('height', v);
        this.eyeL.setAttribute('y', this._eyeY - v / 2);
        this.eyeR.setAttribute('y', this._eyeY - v / 2);
      };
      doSquash(2);
      this.shineL.setAttribute('opacity', 0);
      this.shineR.setAttribute('opacity', 0);
      setTimeout(() => {
        doSquash(18);
        this.shineL.setAttribute('opacity', 0.85);
        this.shineR.setAttribute('opacity', 0.85);
      }, 120);
    }

    setState(state) {
      if (!['idle', 'listening', 'thinking', 'speaking', 'happy'].includes(state)) return;
      this.state = state;
      // gaze targets per state
      if (state === 'thinking') { this._targetGazeX = 3.5; this._targetGazeY = -4; }
      else if (state === 'listening') { this._targetGazeX = 0; this._targetGazeY = -1.5; }
      else { this._targetGazeX = 0; this._targetGazeY = 0; }
    }

    // Called by voice engine with 0..1 amplitude while speaking
    setMouthAmplitude(a) { this.mouthAmp = Math.max(0, Math.min(1, a)); }

    _loop() {
      const step = () => {
        this._t += 0.016;
        const t = this._t;

        // Breathing scale
        const breathe = 1 + Math.sin(t * 1.6) * 0.018;
        const excite = this.state === 'listening' ? 1.03 : this.state === 'happy' ? 1.02 : 1;
        const sc = breathe * excite;
        this.faceG.setAttribute('transform', `translate(${100 - 100 * sc} ${100 - 100 * sc}) scale(${sc})`);

        // Glow pulse
        const gp = 0.30 + Math.sin(t * 1.6) * 0.05 +
          (this.state === 'speaking' ? this.mouthAmp * 0.22 : 0) +
          (this.state === 'listening' ? 0.12 : 0);
        this.glow.setAttribute('opacity', gp.toFixed(3));
        this.glow.setAttribute('r', (52 + Math.sin(t * 1.6) * 2 + (this.state === 'listening' ? 4 : 0)).toFixed(2));

        // Aura rings rotate/pulse
        const auraOn = this.state === 'listening' || this.state === 'thinking';
        this.auraMid.setAttribute('opacity', (0.20 + (auraOn ? 0.18 : 0) + Math.sin(t * 2) * 0.05).toFixed(3));
        this.auraOuter.setAttribute('opacity', (0.12 + (auraOn ? 0.12 : 0) + Math.sin(t * 2 + 1) * 0.04).toFixed(3));

        // Gaze easing
        this._gazeX += (this._targetGazeX - this._gazeX) * 0.08;
        this._gazeY += (this._targetGazeY - this._gazeY) * 0.08;
        // subtle idle wander
        const wanderX = this.state === 'idle' ? Math.sin(t * 0.5) * 1.6 : 0;
        this.eyesG.setAttribute('transform', `translate(${(this._gazeX + wanderX).toFixed(2)} ${this._gazeY.toFixed(2)})`);

        // Sparks orbit when active
        const showSpark = auraOn ? 1 : 0;
        for (let i = 0; i < this.sparks.length; i++) {
          const a = t * 1.4 + (i * Math.PI * 2) / 3;
          const rad = 66;
          const x = 100 + Math.cos(a) * rad;
          const y = 100 + Math.sin(a) * rad;
          this.sparks[i].setAttribute('cx', x.toFixed(2));
          this.sparks[i].setAttribute('cy', y.toFixed(2));
          this.sparks[i].setAttribute('opacity', (showSpark * (0.5 + Math.sin(a * 2) * 0.4)).toFixed(3));
        }

        // Mouth
        let curve = 0.15, open = 0;
        if (this.state === 'happy') curve = 0.9;
        else if (this.state === 'speaking') {
          curve = 0.35;
          open = 0.25 + this.mouthAmp * 0.75 + Math.sin(t * 22) * 0.08 * this.mouthAmp;
        } else if (this.state === 'listening') curve = 0.4;
        else if (this.state === 'thinking') curve = -0.1;
        this.mouth.setAttribute('d', this._mouthPath(curve, Math.max(0, open)));

        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._blinkTimer);
      if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    }
  }

  global.NAIAvatar = Avatar;
})(window);
