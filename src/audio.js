/** Gesture-unlocked procedural effects and an optional embedded music loop. */
export class AudioFX {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.unlocked = false;
    this.unlocking = null;
    this.unlockGeneration = 0; this.everUnlocked = false; this.pageVisible = true; this.lifecycleCleanup = null;
    this.voices = [];
    this.maxVoices = 12;
    this.lastPlayed = new Map();
    this.noise = null;
    this.rollingBuffer = null;
    this.rolling = null;
    this.musicData = '';
    this.musicBuffer = null;
    this.musicDuration = 0;
    this.musicGain = null;
    this.musicSource = null;
    this.musicPlaying = false;
    this.musicOffset = 0;
    this.musicStartedAt = 0;
    this.musicDecoding = null;
    this.musicGeneration = 0;
    this.musicError = null;
    this.disposed = false;
  }

  async unlock({retry=false}={}) {
    if (this.disposed || !this.pageVisible) return false;
    if (this.unlocked && this.context?.state === 'running') return true;
    if (this.unlocking && !retry) return this.unlocking;
    this.unlocked = false;
    const attempt = this._unlockContext(++this.unlockGeneration);
    this.unlocking = attempt;
    try { return await attempt; }
    finally { if (this.unlocking === attempt) this.unlocking = null; }
  }

  async _unlockContext(generation) {
    try {
      if (!this.context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return false;
        const ctx = this.context = new Context({ latencyHint: 'interactive' });
        ctx.onstatechange = () => {
          if (this.disposed || this.context !== ctx) return;
          if (ctx.state !== 'running') { this.unlocked=false;this.stopRolling(); }
          else if(this.everUnlocked&&this.pageVisible){this.unlocked=true;this._prepareMusic();}
          this._syncMusic();
        };
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
      const ctx = this.context;
      if (ctx.state !== 'running') {
        this.stopRolling();
        this._stopMusic();
        // Keep resume() before the first await so it retains user activation.
        await ctx.resume();
      }
      if (this.disposed || generation!==this.unlockGeneration || !this.pageVisible || this.context !== ctx || ctx.state !== 'running') return false;
      // Prepare the reusable texture on the unlocking gesture, not the first roll.
      this.rollingBuffer ||= this._createRollingBuffer();
      // A silent source also unlocks WebAudio on mobile Safari.
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(this.master);
      source.onended = () => source.disconnect();
      source.start();
      this.unlocked = this.everUnlocked = true;
      this._prepareMusic();
      this._syncMusic();
      return this.unlocked;
    } catch (_) { return false; }
  }

  /** Event-driven recovery; no retry timers or new audio contexts on return. */
  bindLifecycle(doc=globalThis.document,win=globalThis.window){
    this.lifecycleCleanup?.();if(!doc?.addEventListener||!win?.addEventListener)return;
    const recover=()=>{if(!doc.hidden)this.setPageVisible(true);};
    const visibility=()=>this.setPageVisible(!doc.hidden),hide=()=>this.setPageVisible(false);
    const gesture=()=>{if(!doc.hidden&&this.everUnlocked&&!this.muted){this.pageVisible=true;void this.unlock({retry:true});}};
    const gestureEvent=win.PointerEvent?'pointerdown':'touchend';
    doc.addEventListener('visibilitychange',visibility);win.addEventListener('pagehide',hide);win.addEventListener('pageshow',recover);win.addEventListener('focus',recover);
    doc.addEventListener(gestureEvent,gesture,{capture:true,passive:true});doc.addEventListener('keydown',gesture,true);
    this.lifecycleCleanup=()=>{doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',recover);win.removeEventListener('focus',recover);doc.removeEventListener(gestureEvent,gesture,true);doc.removeEventListener('keydown',gesture,true);};
    this.pageVisible=!doc.hidden;
  }
  setPageVisible(visible){
    if(this.disposed)return;this.pageVisible=!!visible;
    if(!this.pageVisible){this.unlockGeneration++;this.unlocking=null;this.unlocked=false;this.stopRolling();this._stopMusic();this.voices.splice(0).forEach(v=>this._stop(v));return;}
    if(this.everUnlocked&&!this.muted&&this.context?.state!=='closed')void this.unlock();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this.stopRolling();
    this._syncMusic();
    if (!this.context || !this.master) return;
    try {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.56, now, 0.012);
      if (this.muted) this.voices.splice(0).forEach(v => this._stop(v));
    } catch (_) { /* Audio is optional. */ }
  }

  /** Store an embedded data URL without fetching, decoding, or autoplaying it. */
  setMusicData(dataURL) {
    if (this.disposed) return;
    const data = typeof dataURL === 'string' ? dataURL : '';
    if (data === this.musicData) return;
    this._stopMusic();
    this.musicGeneration++;
    this.musicData = data;
    this.musicBuffer = null;
    this.musicDuration = 0;
    this.musicOffset = 0;
    this.musicDecoding = null;
    this.musicError = null;
    this._prepareMusic();
  }

  /** Caller combines game, pause, Test menu, and visibility state. Safe per frame. */
  setMusicPlaying(playing) {
    if (this.disposed) return;
    this.musicPlaying = Boolean(playing);
    this._syncMusic();
  }

  _prepareMusic() {
    if (this.disposed || !this.unlocked || !this.context || !this.musicData || this.musicBuffer || this.musicError) return;
    if (this.musicDecoding) return this.musicDecoding;
    const ctx = this.context, generation = this.musicGeneration, dataURL = this.musicData;
    const current = () => !this.disposed && this.context === ctx && this.musicGeneration === generation;
    const attempt = Promise.resolve().then(() => {
      if (!current()) return null;
      const comma = dataURL.indexOf(',');
      if (comma < 0 || !/^data:[^,]*;base64$/i.test(dataURL.slice(0, comma))) throw new Error('Music must be an embedded base64 audio data URL.');
      const data = atob(dataURL.slice(comma + 1));
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      // Callback support also covers older Safari; modern promise results share
      // the same settlement, so the asset is decoded exactly once either way.
      return new Promise((resolve, reject) => {
        const result = ctx.decodeAudioData(bytes.buffer, resolve, reject);
        if (result?.then) result.then(resolve, reject);
      });
    }).then(buffer => {
      if (!current()) return false;
      if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('Music has no playable duration.');
      this.musicBuffer = buffer;
      this.musicDuration = buffer.duration;
      this._syncMusic();
      return true;
    }).catch(error => {
      if (current()) this.musicError = error;
      return false; // Audio failures must never interrupt gameplay or effects.
    }).finally(() => {
      if (this.musicDecoding === attempt) this.musicDecoding = null;
    });
    this.musicDecoding = attempt;
    return attempt;
  }

  _syncMusic() {
    const ctx = this.context;
    if (this.disposed || !this.pageVisible || !this.musicPlaying || this.muted || !this.unlocked || ctx?.state !== 'running') {
      this._stopMusic();
      return;
    }
    if (this.musicSource || !this.musicBuffer || this.musicError) return;
    let source;
    try {
      if (!this.musicGain) {
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = 0.3;
        this.musicGain.connect(this.master);
      }
      source = ctx.createBufferSource();
      source.buffer = this.musicBuffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = this.musicDuration;
      source.playbackRate.value = 1; // Game slow motion never changes the score.
      source.connect(this.musicGain);
      this.musicOffset %= this.musicDuration;
      this.musicStartedAt = ctx.currentTime;
      this.musicSource = source;
      source.onended = () => {
        if (this.musicSource === source) this.musicSource = null;
        try { source.disconnect(); } catch (_) {}
      };
      // Preserve the complete decoded track, including its authored loop edges.
      source.start(0, this.musicOffset);
    } catch (error) {
      this.musicError = error;
      if (this.musicSource === source) this.musicSource = null;
      if (source) this._stop({ sources: [source], nodes: [] });
    }
  }

  _stopMusic() {
    const source = this.musicSource;
    if (!source) return;
    this.musicSource = null;
    if (this.musicDuration > 0 && this.context) {
      const elapsed = Math.max(0, this.context.currentTime - this.musicStartedAt);
      this.musicOffset = (this.musicOffset + elapsed) % this.musicDuration;
    }
    source.onended = null;
    this._stop({ sources: [source], nodes: [] });
  }

  _createRollingBuffer() {
    const ctx = this.context, length = Math.round(ctx.sampleRate * 0.64);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0), grain = new Float32Array(length);
    let seed = 0x5a17c9e3;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < length; i++) {
      grain[i] = random() * 2 - 1;
    }
    const coefficient = hz => 1 - Math.exp(-2 * Math.PI * hz / ctx.sampleRate);
    const low = coefficient(145), dc = coefficient(28);
    let first = 0, second = 0, third = 0, sub = 0, sum = 0, peak = 0;
    // Three low-pass stages remove the broad bright noise that reads as hiss.
    // Warming the cyclic filters keeps the rumble seamless without volume dips.
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < length; i++) {
      first += low * (grain[i] - first);
      second += low * (first - second);
      third += low * (second - third);
      sub += dc * (third - sub);
      if (pass < 2) continue;
      data[i] = third - sub;
      sum += data[i] * data[i];
    }
    const bodyScale = 0.14 / Math.sqrt(sum / length);
    for (let i = 0; i < length; i++) data[i] *= bodyScale;
    // Sparse, irregular micro-contacts give a rolling surface rhythm. Each is
    // a rounded damped tick with faint metal modes, never a white-noise burst.
    for (let start = 0.013; start < buffer.duration; start += 0.033 + random() * 0.049) {
      const offset = Math.round(start * ctx.sampleRate);
      const strength = 0.12 + random() * 0.08, hz = 155 + random() * 95;
      const decay = 0.006 + random() * 0.005, metal = 480 + random() * 140;
      for (let i = 0; i < ctx.sampleRate * 0.12; i++) {
        const t = i / ctx.sampleRate, attack = 1 - Math.exp(-t / 0.0018);
        const tick = strength * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / decay);
        const ring = 0.011 * Math.sin(2 * Math.PI * metal * t) * Math.exp(-t / 0.014)
          + 0.004 * Math.sin(2 * Math.PI * metal * 1.47 * t) * Math.exp(-t / 0.009);
        data[(offset + i) % length] += (tick + ring) * attack;
      }
    }
    sum = 0;
    for (const sample of data) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    const scale = Math.min(0.2 / Math.sqrt(sum / length), 0.72 / peak);
    for (let i = 0; i < length; i++) data[i] *= scale;
    return buffer;
  }

  _rollingParam(param, value, now, smoothing) {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, smoothing);
  }

  _ensureRolling() {
    if (this.rolling) return this.rolling;
    const ctx = this.context;
    this.rollingBuffer ||= this._createRollingBuffer();
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = this.rollingBuffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = this.rollingBuffer.duration;
    source.playbackRate.value = 0.48;
    gain.gain.value = 0;
    try {
      source.connect(gain); gain.connect(this.master);
      source.start();
    } catch (error) {
      this._stop({ sources: [source], nodes: [gain] });
      throw error;
    }
    return this.rolling = { source, gain, speed: 0, intensity: 0, active: false };
  }

  /** One shared mix. Caller supplies grounded tangent speed in world units/s. */
  updateRolling(speed, intensity = 1, dt = 1 / 60) {
    if (this.disposed || !this.pageVisible || this.muted || !this.unlocked || this.context?.state !== 'running') {
      this.stopRolling();
      return;
    }
    speed = Number.isFinite(speed) ? Math.max(0, Math.min(64, speed)) : 0;
    intensity = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 1 / 60;
    if (speed < 0.035 || !intensity || !dt) { this.stopRolling(); return; }
    try {
      const rolling = this._ensureRolling(), now = this.context.currentTime;
      rolling.speed += (speed - rolling.speed) * (1 - Math.exp(-dt / 0.06));
      rolling.intensity += (intensity - rolling.intensity) * (1 - Math.exp(-dt / 0.035));
      const amount = Math.min(1, rolling.speed / 24);
      this._rollingParam(rolling.gain.gain, 0.13 * Math.sqrt(amount) * rolling.intensity, now, 0.018);
      this._rollingParam(rolling.source.playbackRate, 0.48 + Math.min(1.6, rolling.speed / 20), now, 0.025);
      rolling.active = true;
    } catch (_) { this.stopRolling(); }
  }

  /** Fade out and forget motion, retaining the single loop for the next contact. */
  stopRolling() {
    const rolling = this.rolling;
    if (!rolling) return;
    const active = rolling.active;
    rolling.active = false;
    rolling.speed = rolling.intensity = 0;
    try {
      const now = this.context.currentTime;
      if (this.context.state !== 'running') {
        rolling.gain.gain.cancelScheduledValues(now);
        rolling.gain.gain.setValueAtTime(0, now);
        rolling.source.playbackRate.cancelScheduledValues(now);
        rolling.source.playbackRate.setValueAtTime(0.48, now);
      } else if (active) {
        this._rollingParam(rolling.gain.gain, 0, now, 0.025);
        this._rollingParam(rolling.source.playbackRate, 0.48, now, 0.04);
      }
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
    if (this.muted || this.disposed || !this.pageVisible || !this.unlocked || !this.context) return;
    if (this.context.state !== 'running') {
      // Never queue a backlog after a tab interruption. Retry context only.
      void this.unlock({retry:false});
      return;
    }
    const known = ['perfect', 'launch', 'wall', 'hit', 'glassTap', 'ballLand', 'crack', 'chip', 'break', 'fall', 'catch', 'miss', 'clear', 'click', 'aim', 'release', 'land', 'pickup', 'pulse', 'pierce', 'arc', 'frost', 'split', 'gravity', 'heavy', 'bomb', 'blackhole'];
    if (!known.includes(name)) return;
    try {
      const now = this.context.currentTime;
      const cooldown = { aim: 0.065, wall: 0.035, fall: 0.09, hit: 0.018, glassTap: 0.055, ballLand: 0.045, chip: 0.025 }[name] || 0.012;
      if (now - (this.lastPlayed.get(name) ?? -Infinity) < cooldown) return;
      this.lastPlayed.set(name, now);
      const v = this._voice(now), t = now + 0.002;
      const power = Number.isFinite(strength) ? Math.max(0, Math.min(1.5, strength)) : 1;
      const level = Math.sqrt(power) * (['pulse','pierce','arc','frost','split','gravity','heavy','bomb','blackhole'].includes(name)?1.22:1);
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
        case 'frost': [1400,2100,2800].forEach((hz,i)=>tone(hz,.2,.035,'sine',hz*.7,i*.025));noise(.18,.035,4000,'highpass');break;
        case 'split': [-1,0,1].forEach((i)=>tone(480+i*130,.22,.045,'triangle',960+i*180,(i+1)*.025));break;
        case 'gravity': tone(190,.65,.08,'sine',65);tone(380,.4,.025,'triangle',90);noise(.4,.02,350,'lowpass');break;
        case 'blackhole':
          tone(210,1.15,.10,'sine',38); tone(420,.9,.025,'triangle',75,.06);
          noise(.65,.055,260,'lowpass'); tone(52,1.3,.06,'sine',29,.18);
          break;
        case 'bomb':
          // A sharp crack, chesty falling fundamental, then a short rolling tail.
          tone(145,.65,.22,'sine',28); tone(76,.48,.13,'triangle',24,.035);
          noise(.12,.15,1800,'bandpass'); noise(.62,.19,480,'lowpass',.018);
          noise(.24,.055,3200,'highpass',.09); tone(42,.55,.075,'sine',23,.12);
          break;
        case 'heavy': tone(130,.28,.13,'sine',32);noise(.14,.09,700,'lowpass');break;
        case 'perfect':
          tone(660,.16,.09,'sine',880);tone(990,.22,.075,'sine',1320,.055);break;
        case 'launch':
          tone(290, 0.14, 0.15, 'sine', 115); noise(0.07, 0.065, 1300, 'bandpass'); break;
        case 'wall':
          tone(620, 0.065, 0.065, 'sine', 380); tone(1240, 0.035, 0.018); break;
        case 'hit':
          tone(pitch, 0.13, 0.075); tone(pitch * 2.71, 0.065, 0.025); noise(0.025, 0.035, 3000); break;
        case 'glassTap':
          tone(pitch * 0.82, 0.085, 0.035); tone(pitch * 2.31, 0.05, 0.01);
          tone(170, 0.045, 0.018, 'sine', 105); noise(0.012, 0.014, 1200, 'bandpass'); break;
        case 'ballLand': {
          // A short stone-contact body with soft inharmonic metal overtones.
          const variant = 0.94 + index * 0.03;
          tone(190 * variant, 0.075, 0.09, 'sine', 112 * variant);
          tone(540 * variant, 0.095, 0.025, 'sine', 510 * variant);
          tone(835 * variant, 0.055, 0.009, 'sine', 805 * variant);
          break;
        }
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
    this.lifecycleCleanup?.();this.lifecycleCleanup=null;this.unlockGeneration++;
    this.disposed = true;
    this.unlocked = false;
    this.unlocking = null;
    this._stopMusic();
    this.musicGeneration++;
    this.musicPlaying = false;
    this.musicData = '';
    this.musicBuffer = null;
    this.musicDuration = 0;
    this.musicOffset = 0;
    this.musicDecoding = null;
    this.musicError = null;
    try { this.musicGain?.disconnect(); } catch (_) {}
    this.musicGain = null;
    if (this.rolling) this._stop({ sources: [this.rolling.source], nodes: [this.rolling.gain] });
    this.rolling = null;
    this.rollingBuffer = null;
    this.voices.splice(0).forEach(v => this._stop(v));
    this.lastPlayed.clear();
    try { this.master?.disconnect(); this.limiter?.disconnect(); } catch (_) {}
    if (this.context) this.context.onstatechange = null;
    try { this.context?.close().catch(() => {}); } catch (_) {}
    this.context = null;
    this.master = null;
    this.noise = null;
  }
}
