// Procedural Web Audio soundscape: layered wind tied to gusts, sparse distant birds (curlew-like calls),
// a far shoreline wash, damp footsteps with armor for the knight, bells, and puzzle sounds. Starts on a gesture.
import * as THREE from 'three/webgpu';
import { WIND } from '../render/settings';

export class Soundscape {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private windGain!: GainNode; private windFilter!: BiquadFilterNode;
  private windHi!: GainNode;
  private reverb!: ConvolverNode; private reverbGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private birdT = 4;
  volume = 0.8;
  muted = false;
  listener = new THREE.Vector3(); listenerYaw = 0;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // Noise buffer (brown-ish) for wind and footsteps.
    const len = ctx.sampleRate * 4;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 * 0.6 + w * 0.12; }
    // Reverb impulse: long soft decay for an open moor.
    const irLen = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    // Wind: two filtered noise layers.
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.25;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    const src2 = ctx.createBufferSource(); src2.buffer = this.noiseBuf; src2.loop = true; src2.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9;
    this.windHi = ctx.createGain(); this.windHi.gain.value = 0.02;
    src2.connect(bp).connect(this.windHi).connect(this.master);
    src2.start();
    // Distant shoreline: very slow swelling low wash.
    const src3 = ctx.createBufferSource(); src3.buffer = this.noiseBuf; src3.loop = true; src3.playbackRate.value = 0.5;
    const lp3 = ctx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 260;
    const g3 = ctx.createGain(); g3.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.04;
    lfo.connect(lfoG).connect(g3.gain); lfo.start();
    const pan3 = ctx.createStereoPanner(); pan3.pan.value = 0.6;
    src3.connect(lp3).connect(g3).connect(pan3).connect(this.master);
    src3.start();
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.1); }
  setMuted(m: boolean) { this.muted = m; this.setVolume(this.volume); }

  update(dt: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = WIND.gust;
    this.windGain.gain.setTargetAtTime(0.2 + g * 0.55, t, 0.35);
    this.windFilter.frequency.setTargetAtTime(340 + g * 1100, t, 0.4);
    this.windHi.gain.setTargetAtTime(0.012 + g * 0.07, t, 0.25);
    this.birdT -= dt;
    if (this.birdT < 0) { this.birdT = 7 + Math.random() * 14; this.bird(); }
  }

  private panFor(pos?: THREE.Vector3) {
    if (!pos) return { pan: 0, gain: 1 };
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz, pos.y - this.listener.y);
    const ang = Math.atan2(dx, dz) - this.listenerYaw;
    return { pan: THREE.MathUtils.clamp(-Math.sin(ang), -1, 1) * 0.8, gain: 1 / (1 + d * 0.25) };
  }

  private out(pan: number, gain: number, wet = 0.3) {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(this.master);
    const w = ctx.createGain(); w.gain.value = wet; p.connect(w).connect(this.reverb);
    return g;
  }

  private bird() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const o = this.out((Math.random() - 0.5) * 1.6, 0.025, 0.8);
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0;
      const st = t0 + i * 0.42;
      const f = 1500 + Math.random() * 300;
      osc.frequency.setValueAtTime(f * 0.8, st); osc.frequency.exponentialRampToValueAtTime(f * 1.25, st + 0.3);
      g.gain.linearRampToValueAtTime(1, st + 0.06); g.gain.linearRampToValueAtTime(0, st + 0.36);
      osc.connect(g).connect(o); osc.start(st); osc.stop(st + 0.4);
    }
  }

  footstep(kind: 'knight' | 'kitten', pos: THREE.Vector3, strength: number, wet: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const { pan, gain } = this.panFor(pos);
    const knight = kind === 'knight';
    const o = this.out(pan, gain * (knight ? 0.5 : 0.11) * (0.4 + 0.6 * strength), 0.15);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = knight ? 0.8 : 2.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = (knight ? 700 : 1800) + wet * 600;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + (knight ? 0.22 : 0.08));
    src.connect(lp).connect(g).connect(o);
    src.start(t0, Math.random() * 3, 0.3);
    if (knight) {
      // Restrained armor: a couple of short, inharmonic plate taps.
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator(); osc.type = 'triangle';
        osc.frequency.value = 1800 + Math.random() * 1600;
        const ag = ctx.createGain(); const st = t0 + 0.02 + i * 0.05 + Math.random() * 0.03;
        ag.gain.setValueAtTime(0, st); ag.gain.linearRampToValueAtTime(0.06 * strength, st + 0.004); ag.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
        osc.connect(ag).connect(o); osc.start(st); osc.stop(st + 0.15);
      }
    }
  }

  play(name: string, pos?: THREE.Vector3, gainIn = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const { pan, gain } = this.panFor(pos);
    const noise = (dur: number, f: number, q: number, type: BiquadFilterType, g: number, rate = 1, wet = 0.3) => {
      const o = this.out(pan, gain * gainIn * g, wet);
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = rate;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const e = ctx.createGain(); e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(1, t0 + 0.05); e.gain.linearRampToValueAtTime(0, t0 + dur);
      s.connect(fl).connect(e).connect(o); s.start(t0, Math.random() * 2, dur + 0.1);
      return fl;
    };
    const bell = (base: number, g: number, wet: number, decay: number, lp?: number, at = t0) => {
      const o = this.out(pan, g, wet);
      let dest: AudioNode = o;
      if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.connect(o); dest = f; }
      for (const [ratio, amp] of [[0.5, 0.35], [1, 1], [1.183, 0.5], [1.506, 0.35], [2, 0.3], [2.514, 0.18], [3.011, 0.1]]) {
        const osc = ctx.createOscillator(); osc.frequency.value = base * ratio;
        const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(amp, at + 0.008); e.gain.exponentialRampToValueAtTime(0.0001, at + decay * (ratio < 1.2 ? 1 : 0.5));
        osc.connect(e).connect(dest); osc.start(at); osc.stop(at + decay + 0.1);
      }
    };
    switch (name) {
      case 'gate': { const f = noise(3.6, 300, 3, 'bandpass', 0.35, 0.6); f.frequency.linearRampToValueAtTime(520, t0 + 3.5); noise(3.6, 2600, 8, 'bandpass', 0.05, 1.2); break; }
      case 'creak': { const f = noise(1.4, 700, 12, 'bandpass', 0.25, 0.7); f.frequency.linearRampToValueAtTime(420, t0 + 1.3); break; }
      case 'stone': noise(0.6, 180, 1, 'lowpass', 0.6, 0.5); break;
      case 'bolt': noise(0.25, 1400, 4, 'bandpass', 0.4, 1.0); noise(0.5, 200, 1, 'lowpass', 0.4, 0.5); break;
      case 'door': { const f = noise(2.2, 380, 6, 'bandpass', 0.3, 0.5); f.frequency.linearRampToValueAtTime(260, t0 + 2); break; }
      case 'thud': noise(0.3, 160, 1, 'lowpass', 0.8, 0.6); break;
      case 'clank': bell(2200, 0.05 * gainIn * gain, 0.2, 0.25); break;
      case 'bell': bell(330, 0.22 * gainIn, 0.6, 6.0); break;
      case 'castleBell': bell(196, 0.06 * gainIn, 1.0, 9.0, 900); bell(196, 0.05 * gainIn, 1.0, 9.0, 900, t0 + 2.4); break;
      // A war horn far off in the fog: two detuned brassy voices, a slow swell, a long fall, mostly echo.
      case 'horn': {
        const o = this.out(pan, 0.05 * gainIn, 1.0);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 650; f.Q.value = 0.7; f.connect(o);
        for (const [hz, d] of [[110, 0], [110.6, 0.004], [165, 0.02]]) {
          const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = hz;
          const vib = ctx.createOscillator(); vib.frequency.value = 4.6; const vg = ctx.createGain(); vg.gain.value = 1.2; vib.connect(vg).connect(osc.frequency);
          const e = ctx.createGain(); const st = t0 + d;
          e.gain.setValueAtTime(0, st); e.gain.linearRampToValueAtTime(hz > 150 ? 0.35 : 1, st + 0.6); e.gain.setValueAtTime(hz > 150 ? 0.35 : 1, st + 2.4); e.gain.exponentialRampToValueAtTime(0.0001, st + 4.2);
          osc.connect(e).connect(f); osc.start(st); osc.stop(st + 4.3); vib.start(st); vib.stop(st + 4.3);
        }
        break;
      }
      // Embers: a few sharp pops.
      case 'crackle': for (let i = 0; i < 4; i++) { const at = Math.random() * 0.5; const fl = noise(0.05, 2500 + Math.random() * 2000, 3, 'bandpass', 0.25, 1.5); void fl; void at; } break;
      // A crow, far off: a hoarse falling caw.
      case 'caw': {
        const o = this.out(pan, 0.03 * gainIn * gain, 0.7);
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(720, t0); osc.frequency.exponentialRampToValueAtTime(430, t0 + 0.28);
        const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 1100; fl.Q.value = 2.5;
        const e = ctx.createGain(); e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(1, t0 + 0.03); e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        osc.connect(fl).connect(e).connect(o); osc.start(t0); osc.stop(t0 + 0.35);
        break;
      }
      // A tired breath: a soft swell of low noise.
      case 'breath': { const f = noise(1.6, 420, 0.8, 'lowpass', 0.22, 0.6, 0.2); f.frequency.linearRampToValueAtTime(260, t0 + 1.5); break; }
      // The kitten: a full meow, a small mew, a rolled greeting, a long plaintive cry; and her purr.
      case 'meow': case 'mew': case 'mrrp': case 'cry': this.voice(name, pan, gain * gainIn); break;
      case 'purr': this.purr(pan, gain * gainIn, 3.4); break;
      // A man's low murmur through closed lips, tired: hm.
      case 'hum': {
        const o = this.out(pan, 0.05 * gainIn * gain, 0.25);
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(104, t0); osc.frequency.linearRampToValueAtTime(112, t0 + 0.25); osc.frequency.linearRampToValueAtTime(88, t0 + 1.0);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 1.4;
        const e = ctx.createGain(); e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(1, t0 + 0.12); e.gain.setValueAtTime(1, t0 + 0.55); e.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
        osc.connect(lp).connect(e).connect(o); osc.start(t0); osc.stop(t0 + 1.15);
        noise(0.9, 380, 0.8, 'lowpass', 0.08, 0.6, 0.2);
        break;
      }
    }
  }

  // A kitten's voice: a bright, reedy tone whose pitch rises and falls while her mouth opens and rounds (m-i-a-o-w):
  // three formant bands move from closed to open to round, a little breath runs through them, and no two are alike.
  // A small vocal tract puts the formants about twice as high as a person's.
  private voice(kind: string, pan: number, gain: number) {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const S = {
      meow: { dur: 0.6, f0: 760, rise: 1.3, fall: 0.84, g: 0.2, trill: 0 },
      mew: { dur: 0.3, f0: 960, rise: 1.16, fall: 0.94, g: 0.13, trill: 0 },
      mrrp: { dur: 0.36, f0: 620, rise: 1.45, fall: 1.3, g: 0.15, trill: 1 },
      cry: { dur: 0.95, f0: 740, rise: 1.36, fall: 0.78, g: 0.22, trill: 0 },
    }[kind]!;
    const jit = 0.93 + Math.random() * 0.14;
    const f0 = S.f0 * jit, D = S.dur * (0.9 + Math.random() * 0.2);
    const o = this.out(pan, gain * S.g, 0.22);
    // The mouth: closed (m), open (a), rounding (ow); a mew stays nearer the i.
    const mew = kind === 'mew';
    const F: [number, number, number][] = [
      [700, mew ? 1300 : 1500, mew ? 1100 : 900],
      [3600, mew ? 3000 : 2400, mew ? 2500 : 1700],
      [5400, 4900, 4100],
    ];
    const amp = [1, 0.75, 0.32];
    const mouth = ctx.createBiquadFilter(); mouth.type = 'lowpass'; mouth.Q.value = 0.6;
    mouth.frequency.setValueAtTime(900, t0); mouth.frequency.exponentialRampToValueAtTime(7000, t0 + Math.min(0.07, D * 0.2)); mouth.frequency.exponentialRampToValueAtTime(2600, t0 + D);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(1, t0 + D * 0.12); env.gain.linearRampToValueAtTime(0.8, t0 + D * 0.7); env.gain.exponentialRampToValueAtTime(0.001, t0 + D);
    mouth.connect(env).connect(o);
    const bands = F.map(([a, b, c], i) => {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3.5 + i;
      f.frequency.setValueAtTime(a, t0); f.frequency.linearRampToValueAtTime(b, t0 + D * 0.35); f.frequency.linearRampToValueAtTime(c, t0 + D);
      const g = ctx.createGain(); g.gain.value = amp[i] * 2.2;
      f.connect(g).connect(mouth);
      return f;
    });
    // Voice: pitch up into the open vowel, then down; a slight waver.
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 0.86, t0); osc.frequency.linearRampToValueAtTime(f0 * S.rise, t0 + D * 0.35); osc.frequency.linearRampToValueAtTime(f0 * S.fall, t0 + D);
    const vib = ctx.createOscillator(); vib.frequency.value = 5 + Math.random() * 2;
    const vg = ctx.createGain(); vg.gain.value = f0 * 0.014; vib.connect(vg).connect(osc.frequency);
    // A rolled r: the voice pulses at ~28 Hz through the first half.
    let src: AudioNode = osc;
    if (S.trill) {
      const am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 26 + Math.random() * 6;
      const lg = ctx.createGain(); lg.gain.setValueAtTime(0.5, t0); lg.gain.setValueAtTime(0.5, t0 + D * 0.45); lg.gain.linearRampToValueAtTime(0, t0 + D * 0.6);
      am.gain.setValueAtTime(0.5, t0 + D * 0.45); am.gain.linearRampToValueAtTime(1, t0 + D * 0.6);
      lfo.connect(lg).connect(am.gain);
      osc.connect(am); src = am;
      lfo.start(t0); lfo.stop(t0 + D + 0.05);
    }
    for (const b of bands) src.connect(b);
    // Breath through the same mouth.
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.playbackRate.value = 1.3;
    const ng = ctx.createGain(); ng.gain.value = 0.08;
    n.connect(ng); for (const b of bands) ng.connect(b);
    osc.start(t0); osc.stop(t0 + D + 0.05); vib.start(t0); vib.stop(t0 + D + 0.05);
    n.start(t0, Math.random() * 2, D + 0.05);
  }

  // Purring: a low rumble pulsing about 25 times a second, louder breathing out than in.
  private purr(pan: number, gain: number, dur: number) {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const o = this.out(pan, gain * 0.85, 0.1);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.playbackRate.value = 0.7; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.9;
    const am = ctx.createGain(); am.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 24 + Math.random() * 3;
    const lg = ctx.createGain(); lg.gain.value = 0.45; lfo.connect(lg).connect(am.gain);
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t0);
    // Out (1.0 s) and in (0.7 s), over and over.
    let t = t0;
    while (t < t0 + dur - 0.4) {
      env.gain.linearRampToValueAtTime(1, t + 0.2); env.gain.linearRampToValueAtTime(0.85, t + 0.95);
      env.gain.linearRampToValueAtTime(0.35, t + 1.05); env.gain.linearRampToValueAtTime(0.45, t + 1.6);
      t += 1.7;
    }
    env.gain.linearRampToValueAtTime(0, t + 0.3);
    n.connect(lp).connect(am).connect(env).connect(o);
    n.start(t0, Math.random() * 2); n.stop(t + 0.35);
    lfo.start(t0); lfo.stop(t + 0.35);
  }
}
