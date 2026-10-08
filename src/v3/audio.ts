// Procedural Web Audio soundscape: layered wind tied to gusts, sparse distant birds (curlew-like calls),
// a far shoreline wash, damp footsteps with armor for the knight, bells, and puzzle sounds. Starts on a gesture.
import * as THREE from 'three';
import { WIND } from './body';

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
    this.windGain.gain.setTargetAtTime(0.18 + WIND.base * 0.06 + g * 0.5, t, 0.35);
    this.windFilter.frequency.setTargetAtTime(340 + WIND.base * 160 + g * 1000, t, 0.4);
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
      // Into the water: a slap and a wash; a paddle stroke, small.
      case 'splash': noise(0.45, 900, 0.8, 'bandpass', 0.5, 0.9, 0.2); noise(0.9, 380, 0.7, 'lowpass', 0.35, 0.5, 0.25); break;
      case 'paddle': noise(0.18, 1300, 1.2, 'bandpass', 0.12, 1.1, 0.15); break;
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

  // A short score for a story moment (the prologue's ending): a slow string pad in B minor turning to D, a low
  // drone, and over it a sparse, bell-soft melody, all in a long reverb. About 36 s; stop() fades it out.
  theme(gainIn = 1) {
    if (!this.ctx) return { stop: (_f?: number) => {} };
    const ctx = this.ctx, t0 = ctx.currentTime + 0.1;
    const bus = ctx.createGain(); bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(0.9 * gainIn, t0 + 4);
    bus.connect(this.master);
    const wet = ctx.createGain(); wet.gain.value = 0.9; bus.connect(wet).connect(this.reverb);
    const hz = (n: string) => {
      const m = /^([A-G])(#?)(\d)$/.exec(n)!;
      const semi = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as 'A'] + (m[2] ? 1 : 0) + (+m[3] - 4) * 12;
      return 440 * Math.pow(2, semi / 12);
    };
    const BAR = 4.5;
    const chords = [['B2', 'F#3', 'B3', 'D4'], ['G2', 'D3', 'B3', 'D4'], ['D3', 'A3', 'D4', 'F#4'], ['A2', 'E3', 'C#4', 'E4'],
      ['B2', 'F#3', 'B3', 'D4'], ['G2', 'D3', 'B3', 'G4'], ['E3', 'B3', 'E4', 'G4'], ['D3', 'A3', 'D4', 'F#4']];
    // The pad: two slightly detuned soft voices per note, swelling in and out across each bar.
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 900; padF.Q.value = 0.4; padF.connect(bus);
    chords.forEach((ch, i) => {
      const at = t0 + i * BAR, end = at + BAR + 1.2;
      for (const n of ch) for (const det of [-4, 4]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(n); o.detune.value = det;
        const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.022, at + 1.4); e.gain.setValueAtTime(0.022, at + BAR - 0.4); e.gain.linearRampToValueAtTime(0, end);
        o.connect(e).connect(padF); o.start(at); o.stop(end + 0.1);
      }
      // The drone under it, a slow-bowed low root.
      const d = ctx.createOscillator(); d.type = 'sawtooth'; d.frequency.value = hz(ch[0]) / 2;
      const dv = ctx.createOscillator(); dv.frequency.value = 4.8; const dg = ctx.createGain(); dg.gain.value = 0.6; dv.connect(dg).connect(d.frequency);
      const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 280;
      const de = ctx.createGain(); de.gain.setValueAtTime(0, at); de.gain.linearRampToValueAtTime(0.03, at + 1.8); de.gain.linearRampToValueAtTime(0, end);
      d.connect(dl).connect(de).connect(bus); d.start(at); d.stop(end + 0.1); dv.start(at); dv.stop(end + 0.1);
    });
    // The melody: [bar, beat (s into the bar), note, length (s)].
    const mel: [number, number, string, number][] = [
      [0, 0.6, 'F#5', 1], [0, 1.6, 'D5', 1], [0, 2.6, 'B4', 1.8],
      [1, 0.6, 'D5', 1], [1, 1.6, 'B4', 1], [1, 2.6, 'G4', 1.8],
      [2, 0.6, 'A4', 1], [2, 1.6, 'D5', 1], [2, 2.6, 'F#5', 1], [2, 3.6, 'E5', 1.2],
      [3, 0.6, 'E5', 1], [3, 1.6, 'C#5', 1], [3, 2.6, 'A4', 1.8],
      [4, 0.6, 'F#5', 1], [4, 1.6, 'E5', 1], [4, 2.6, 'D5', 1], [4, 3.6, 'B4', 1.2],
      [5, 0.6, 'D5', 1], [5, 1.6, 'E5', 1], [5, 2.6, 'F#5', 1.8],
      [6, 0.6, 'G5', 1], [6, 1.6, 'F#5', 1], [6, 2.6, 'E5', 1.8],
      [7, 0.6, 'F#5', 2.2], [7, 2.8, 'D5', 3.0],
    ];
    for (const [bar, beat, n, len] of mel) {
      const at = t0 + bar * BAR + beat, f = hz(n);
      for (const [ratio, amp] of [[1, 0.05], [2, 0.012], [3, 0.004]] as const) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
        const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(amp, at + 0.012); e.gain.exponentialRampToValueAtTime(amp * 0.25, at + len * 0.6); e.gain.exponentialRampToValueAtTime(0.0001, at + len + 1.2);
        o.connect(e).connect(bus); o.start(at); o.stop(at + len + 1.3);
      }
    }
    return {
      stop: (fade = 3) => {
        const t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + fade);
      },
    };
  }

  // A man speaking inside a closed helm, tired and quiet: a low voice running through a syllable per vowel group of
  // the line (vowel formants shifting, a breath of consonant before each), falling in pitch toward the end (rising
  // for a question), then muffled by the steel: lowpassed hard, a short ringing comb, a little hollow resonance. The
  // words cannot be made out; the subtitles carry them. Returns how long it runs (s).
  speak(line: string, pos?: THREE.Vector3, gainIn = 1) {
    const words = line.replace(/[^a-zA-Z' ,.?!]/g, '').split(/\s+/).filter(Boolean);
    const sylls: { pause: number }[] = [];
    for (const w of words) {
      const n = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length - (/[^aeiou]e$/i.test(w) && w.length > 3 ? 1 : 0));
      for (let i = 0; i < n; i++) sylls.push({ pause: i === n - 1 ? (/[,.?!]$/.test(w) ? 0.26 : 0.05) : 0 });
    }
    let total = 0;
    const durs = sylls.map((s) => { const d = 0.13 + Math.random() * 0.09; total += d + s.pause; return d; });
    if (!this.ctx) return total;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const { pan, gain } = this.panFor(pos);
    const o = this.out(pan, gain * gainIn * 0.22, 0.12);
    // The helm: muffled, a faint metal ring and a hollow peak.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.9;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900;
    const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 480; peak.Q.value = 3; peak.gain.value = 7;
    const comb = ctx.createDelay(0.05); comb.delayTime.value = 0.0031;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    lp.connect(lp2).connect(peak).connect(o);
    peak.connect(comb); comb.connect(fb).connect(comb); comb.connect(o);
    const env = ctx.createGain(); env.gain.value = 0;
    env.connect(lp);
    // The voice: a low buzz and some breath, through three formant bands.
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const breath = ctx.createBufferSource(); breath.buffer = this.noiseBuf; breath.loop = true;
    const bg = ctx.createGain(); bg.gain.value = 0.18; breath.connect(bg);
    const VOW: [number, number, number][] = [[730, 1090, 2440], [530, 1840, 2480], [300, 2200, 2900], [570, 840, 2410], [320, 870, 2240], [660, 1720, 2410]];
    const bands = [0, 1, 2].map((i) => {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [6, 9, 11][i];
      const g = ctx.createGain(); g.gain.value = [1.6, 0.8, 0.35][i];
      osc.connect(f); bg.connect(f); f.connect(g).connect(env);
      return f;
    });
    // A breath of consonant before most syllables.
    const cons = ctx.createBufferSource(); cons.buffer = this.noiseBuf; cons.loop = true; cons.playbackRate.value = 1.6;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 2400; cf.Q.value = 1.2;
    const cg = ctx.createGain(); cg.gain.value = 0;
    cons.connect(cf).connect(cg).connect(lp);
    const question = /\?\s*$/.test(line);
    const f0 = 96 + Math.random() * 8;
    let t = t0;
    sylls.forEach((s, i) => {
      const d = durs[i], a = i / Math.max(1, sylls.length - 1);
      const v = VOW[Math.floor(Math.random() * VOW.length)];
      bands.forEach((b, k) => b.frequency.setTargetAtTime(v[k] * (0.95 + Math.random() * 0.1), t, 0.025));
      const pitch = f0 * (1.12 - 0.22 * a + (question && a > 0.75 ? (a - 0.75) * 1.4 : 0)) * (0.96 + Math.random() * 0.08);
      osc.frequency.setTargetAtTime(pitch, t, 0.04);
      const amp = 0.55 + 0.45 * Math.random();
      env.gain.setTargetAtTime(amp, t + 0.012, 0.025);
      env.gain.setTargetAtTime(0.06, t + d * 0.78, 0.03);
      if (Math.random() < 0.7) { cg.gain.setTargetAtTime(0.2, t - 0.03, 0.01); cg.gain.setTargetAtTime(0, t + 0.01, 0.015); }
      t += d;
      if (s.pause) { env.gain.setTargetAtTime(0, t, 0.03); t += s.pause; }
    });
    env.gain.setTargetAtTime(0, t, 0.05);
    for (const src of [osc, breath, cons]) { src.start(t0); src.stop(t + 0.4); }
    return total;
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
