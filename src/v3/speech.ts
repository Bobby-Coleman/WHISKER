// Spoken lines (engine v2): the knight's muffled voice from inside his helm (audio.ts `speak`) with the words as
// subtitles low on the screen, over the letterbox.
import * as THREE from 'three';
import type { Soundscape } from './audio';

export class Subtitles {
  el: HTMLDivElement;
  private t = 0;
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(11vh + 14px);text-align:center;z-index:6;pointer-events:none;color:#f1ece2;font:italic clamp(17px,2.4vw,26px) "Cormorant Garamond",Georgia,serif;letter-spacing:.02em;text-shadow:0 1px 3px #000,0 0 14px rgba(0,0,0,.7);padding:0 16px;opacity:0;transition:opacity .35s';
    document.body.appendChild(this.el);
  }
  show(text: string, seconds: number) {
    this.el.textContent = text;
    this.el.style.opacity = '1';
    clearTimeout(this.t);
    this.t = setTimeout(() => { this.el.style.opacity = '0'; }, seconds * 1000) as unknown as number;
  }
  hide() { this.el.style.opacity = '0'; }
}

// He says a line: his voice from his helm, the words on screen while he speaks and a little after. Returns its length (s).
export function say(audio: Soundscape, subs: Subtitles, line: string, from: THREE.Vector3, gain = 1) {
  const dur = audio.speak(line, from, gain);
  subs.show(line, dur + 1.3);
  return dur;
}
