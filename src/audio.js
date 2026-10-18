/** Small, gesture-unlocked procedural sound engine. No files, music, or autoplay. */
export class AudioFX {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.unlocked = false;
    this.voices = [];
    this.maxVoices = 12;
    this.lastPlayed = new Map();
    this.noise = null;
    this.disposed = false;
  }

  async unlock() {
    if (this.disposed) return false;
    try {
      if (!this.context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return false;
        const ctx = this.context = new Context({ latencyHint: 'interactive' });
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.56;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.knee.value = 12;
        limiter.ratio.value = 5;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        this.master.connect(limiter);
        limiter.connect(ctx.destination);
        this.limiter = limiter;
        this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.7), ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state !== 'running') await this.context.resume();
      // A silent source also unlocks WebAudio on mobile Safari.
      const source = this.context.createBufferSource();
      source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      source.connect(this.master);
      source.onended = () => source.disconnect();
      source.start();
      this.unlocked = this.context.state === 'running';
      return this.unlocked;
    } catch (_) { return false; }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.context || !this.master) return;
    try {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.56, now, 0.012);
      if (this.muted) this.voices.splice(0).forEach(v => this._stop(v));
    } catch (_) { /* Audio is optional. */ }
  }

  _stop(voice) {
    for (const source of voice.sources) {
      try { source.stop(); } catch (_) { /* Already stopped. */ }
      try { source.disconnect(); } catch (_) { /* Already detached. */ }
    }
    for (const node of voice.nodes) { try { node.disconnect(); } catch (_) {} }
  }

  _voice(now) {
    this.voices = this.voices.filter(v => {
      if (v.until > now) return true;
      this._stop(v);
      return false;
    });
    while (this.voices.length >= this.maxVoices) this._stop(this.voices.shift());
    const voice = { sources: [], nodes: [], until: now + 0.04 };
    this.voices.push(voice);
    return voice;
  }

  _tone(voice, at, frequency, duration, amplitude, shape = 'sine', endFrequency = frequency) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = shape;
    osc.frequency.setValueAtTime(Math.max(20, frequency), at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(amplitude, at + Math.min(0.005, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain); gain.connect(this.master);
    voice.sources.push(osc); voice.nodes.push(gain);
    voice.until = Math.max(voice.until, at + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at); osc.stop(at + duration + 0.01);
  }

  _noise(voice, at, duration, amplitude, frequency = 2400, band = 'highpass') {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    filter.type = band;
    filter.frequency.value = frequency;
    filter.Q.value = 0.65;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(amplitude, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    voice.sources.push(source); voice.nodes.push(filter, gain);
    voice.until = Math.max(voice.until, at + duration + 0.02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + duration + 0.01);
  }

  play(name, strength = 1, type = 0) {
    if (this.muted || this.disposed || !this.unlocked || !this.context) return;
    if (this.context.state !== 'running') {
      // Never queue a backlog after a tab interruption. Retry context only.
      try { this.context.resume().catch(() => {}); } catch (_) {}
      return;
    }
    const known = ['launch', 'wall', 'hit', 'crack', 'chip', 'break', 'fall', 'catch', 'miss', 'clear', 'click', 'aim', 'release', 'land', 'pickup', 'pulse', 'pierce', 'arc', 'halo'];
    if (!known.includes(name)) return;
    try {
      const now = this.context.currentTime;
      const cooldown = { aim: 0.065, wall: 0.035, fall: 0.09, hit: 0.018, chip: 0.025 }[name] || 0.012;
      if (now - (this.lastPlayed.get(name) ?? -Infinity) < cooldown) return;
      this.lastPlayed.set(name, now);
      const v = this._voice(now), t = now + 0.002;
      const power = Number.isFinite(strength) ? Math.max(0, Math.min(1.5, strength)) : 1;
      const level = Math.sqrt(power);
      const names = ['blue', 'emerald', 'amber', 'violet', 'ruby'];
      const index = typeof type === 'string' ? Math.max(0, names.indexOf(type.toLowerCase())) : Math.abs(Math.trunc(Number(type) || 0)) % 5;
      const pitch = [980, 1175, 740, 1397, 880][index] * (0.985 + Math.random() * 0.03);
      const tone = (hz, dur, amp, shape = 'sine', end = hz, delay = 0) => this._tone(v, t + delay, hz, dur, amp * level, shape, end);
      const noise = (dur, amp, hz = 2400, band = 'highpass', delay = 0) => this._noise(v, t + delay, dur, amp * level, hz, band);
      switch (name) {
        case 'release': tone(520,.14,.06,'sine',1040); tone(1560,.18,.025,'sine',1560,.035); break;
        case 'land': tone(410,.07,.055,'sine',280); tone(890,.11,.035); break;
        case 'pickup': [660,880,1320].forEach((hz,i)=>tone(hz,.17,.055,'sine',hz,i*.045)); break;
        case 'pulse': tone(160,.32,.14,'sine',42); noise(.16,.08,850,'lowpass'); tone(600,.18,.025,'sine',180); break;
        case 'pierce': noise(.08,.065,3700); tone(1400,.12,.055,'triangle',2400); break;
        case 'arc': [0,.035,.08].forEach((d,i)=>{noise(.045,.05,2200+i*900,'bandpass',d);tone(900+i*340,.06,.035,'sawtooth',450,d);}); break;
        case 'halo': [392,587,784,1175].forEach((hz,i)=>tone(hz,.32,.065,'sine',hz,i*.045)); noise(.16,.025,1200,'bandpass'); break;
        case 'launch':
          tone(290, 0.14, 0.15, 'sine', 115); noise(0.07, 0.065, 1300, 'bandpass'); break;
        case 'wall':
          tone(620, 0.065, 0.065, 'sine', 380); tone(1240, 0.035, 0.018); break;
        case 'hit':
          tone(pitch, 0.13, 0.075); tone(pitch * 2.71, 0.065, 0.025); noise(0.025, 0.035, 3000); break;
        case 'crack':
          noise(0.07, 0.11, 1800); tone(pitch * 1.33, 0.16, 0.065); tone(pitch * 3.14, 0.07, 0.025); break;
        case 'chip':
          tone(pitch * 1.7, 0.09, 0.045); noise(0.035, 0.045, 4200); break;
        case 'break':
          noise(0.17, 0.12, 1900);
          [1, 1.47, 2.09, 2.83, 3.72].forEach((ratio, i) => tone(pitch * ratio, 0.32 - i * 0.035, 0.066 / (1 + i * 0.65), 'sine', pitch * ratio * 0.94, i * 0.009));
          tone(155, 0.1, 0.055, 'sine', 65); break;
        case 'fall':
          tone(1100, 0.19, 0.028, 'sine', 380); break;
        case 'catch':
          tone(660, 0.13, 0.085); tone(990, 0.2, 0.06, 'sine', 990, 0.055); break;
        case 'miss':
          tone(230, 0.22, 0.12, 'sine', 90); noise(0.1, 0.045, 480, 'lowpass'); break;
        case 'clear':
          [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
            tone(hz, 0.4, 0.07, 'sine', hz, i * 0.075);
            tone(hz * 2, 0.22, 0.015, 'sine', hz * 2, i * 0.075);
          }); break;
        case 'click': tone(790, 0.045, 0.045, 'sine', 640); break;
        case 'aim': tone(1200, 0.025, 0.012, 'sine', 1100); break;
      }
    } catch (_) { /* Restricted or lost audio devices must not interrupt play. */ }
  }

  dispose() {
    this.disposed = true;
    this.unlocked = false;
    this.voices.splice(0).forEach(v => this._stop(v));
    this.lastPlayed.clear();
    try { this.master?.disconnect(); this.limiter?.disconnect(); } catch (_) {}
    try { this.context?.close().catch(() => {}); } catch (_) {}
    this.context = null;
    this.master = null;
    this.noise = null;
  }
}
