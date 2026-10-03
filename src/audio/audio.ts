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
    }
  }
}
