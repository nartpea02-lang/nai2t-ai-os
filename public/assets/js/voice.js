/* NAI2T AI OS — Voice Engine
 * Web Speech API: SpeechRecognition (listen) + SpeechSynthesis (speak).
 * Voice-first. Low, natural pitch — not metallic/robotic.
 * Gracefully degrades to text-only when the browser lacks support.
 */
(function (global) {
  'use strict';

  const SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  const synth = global.speechSynthesis || null;

  class Voice {
    constructor(opts = {}) {
      this.lang = opts.lang || 'th-TH';
      this.onResult = opts.onResult || function () {};   // (finalText)
      this.onInterim = opts.onInterim || function () {}; // (partialText)
      this.onStart = opts.onStart || function () {};
      this.onEnd = opts.onEnd || function () {};
      this.onSpeakStart = opts.onSpeakStart || function () {};
      this.onSpeakEnd = opts.onSpeakEnd || function () {};
      this.onAmplitude = opts.onAmplitude || function () {}; // (0..1) mouth drive
      this.onError = opts.onError || function () {};

      this.listening = false;
      this.speaking = false;
      this._ampTimer = null;
      this._voice = null;
      this._recog = null;

      this.supported = { recog: !!SR, synth: !!synth };

      if (SR) this._initRecog();
      if (synth) this._loadVoices();
    }

    _initRecog() {
      const r = new SR();
      r.lang = this.lang;
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        let interim = '', fin = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        if (interim) this.onInterim(interim);
        if (fin) this.onResult(fin.trim());
      };
      r.onstart = () => { this.listening = true; this.onStart(); };
      r.onend = () => { this.listening = false; this.onEnd(); };
      r.onerror = (e) => { this.listening = false; this.onError(e.error || 'recog-error'); };
      this._recog = r;
    }

    _loadVoices() {
      const pick = () => {
        const all = synth.getVoices();
        if (!all.length) return;
        // Prefer a Thai voice; fall back to any voice.
        const thai = all.filter(v => /th(-|_)?/i.test(v.lang) || /thai/i.test(v.name));
        // Among Thai voices, prefer Google / natural neural voices over robotic ones.
        const rank = (v) => {
          let s = 0;
          if (/google/i.test(v.name)) s += 4;
          if (/natural|neural|premium|enhanced/i.test(v.name)) s += 3;
          if (/female|kanya|premwadee/i.test(v.name)) s += 1;
          return s;
        };
        if (thai.length) {
          thai.sort((a, b) => rank(b) - rank(a));
          this._voice = thai[0];
        } else {
          this._voice = all.find(v => /google/i.test(v.name)) || all[0];
        }
      };
      pick();
      if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = pick;
    }

    setLang(lang) {
      this.lang = lang;
      if (this._recog) this._recog.lang = lang;
    }

    startListening() {
      if (!this._recog || this.listening) return false;
      if (this.speaking) this.stopSpeaking();
      try { this._recog.start(); return true; }
      catch (e) { return false; }
    }

    stopListening() {
      if (this._recog && this.listening) { try { this._recog.stop(); } catch (e) {} }
    }

    /* speak(text, {dialect}) — dialect 'south' lowers pitch a touch for a warmer,
       slower southern cadence. Returns a promise that resolves when done. */
    speak(text, opts = {}) {
      return new Promise((resolve) => {
        if (!synth || !text) { resolve(); return; }
        this.stopSpeaking();
        // Split long text into sentence chunks for steadier prosody.
        const chunks = String(text).match(/[^.!?。！？\n]+[.!?。！？]?/g) || [text];
        let idx = 0;
        const south = opts.dialect === 'south';

        const speakChunk = () => {
          if (idx >= chunks.length) { this._stopAmp(); this.speaking = false; this.onSpeakEnd(); resolve(); return; }
          const u = new SpeechSynthesisUtterance(chunks[idx].trim());
          u.lang = this.lang;
          if (this._voice) u.voice = this._voice;
          // Low + natural. Southern cadence a hair slower & lower.
          u.pitch = south ? 0.82 : 0.9;
          u.rate = south ? 0.92 : 0.98;
          u.volume = 1;
          u.onstart = () => {
            if (idx === 0) { this.speaking = true; this.onSpeakStart(); this._startAmp(); }
          };
          u.onend = () => { idx++; speakChunk(); };
          u.onerror = () => { idx++; speakChunk(); };
          synth.speak(u);
        };
        speakChunk();
      });
    }

    stopSpeaking() {
      if (synth) { try { synth.cancel(); } catch (e) {} }
      this._stopAmp();
      if (this.speaking) { this.speaking = false; this.onSpeakEnd(); }
    }

    // Synthesis exposes no waveform, so drive the mouth with a natural envelope.
    _startAmp() {
      this._stopAmp();
      let ph = 0;
      this._ampTimer = setInterval(() => {
        ph += 0.35;
        // layered sines + noise => speech-like open/close
        const base = 0.45 + Math.sin(ph) * 0.28 + Math.sin(ph * 2.3) * 0.14;
        const amp = Math.max(0, Math.min(1, base + (Math.random() - 0.5) * 0.15));
        this.onAmplitude(amp);
      }, 70);
    }
    _stopAmp() {
      if (this._ampTimer) { clearInterval(this._ampTimer); this._ampTimer = null; }
      this.onAmplitude(0);
    }
  }

  global.NAIVoice = Voice;
})(window);
