// Input sources are separate from character control so a second player can later drive the other character.
import * as THREE from 'three/webgpu';

export type InputFrame = {
  move: THREE.Vector2; // x right, y forward, magnitude 0..1
  look: THREE.Vector2; // radians this frame (yaw, pitch)
  walk: boolean;
  switchPressed: boolean;
  interactPressed: boolean;
  waitPressed: boolean;
  resetPressed: boolean;
  skipPressed: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean; // the jump button is down (a held jump rises higher)
  hintPressed: boolean;
  zoom: number;
  any: boolean;
};

export class KeyboardMouseGamepad {
  keys = new Set<string>();
  pressed = new Set<string>();
  lookDelta = new THREE.Vector2();
  zoomDelta = 0;
  dragging = false;
  locked = false;
  padPrev: boolean[] = [];
  sensitivity = 0.0032;
  invertY = false;
  // Touch: left thumb is a floating stick, right thumb drags the camera, buttons cover switch, act and wait.
  touchMode = false;
  onTouchMode?: () => void;
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  // On-screen buttons held down (touch).
  private touchHeld = new Set<string>();
  private lookId = -1;
  private lastLook = { x: 0, y: 0 };
  private stickEl?: HTMLDivElement;
  private knobEl?: HTMLDivElement;
  private static STICK_R = 52;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.style.touchAction = 'none';
    // Any touch (the title card included) brings up the on-screen controls.
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.enterTouchMode(); }, { capture: true });
    el.addEventListener('pointerdown', (e) => {
      this.pressed.add('Pointer');
      if (e.pointerType === 'touch') { this.touchDown(e); return; }
      this.dragging = true;
      // Pointer lock is optional (embedded pages may refuse it); dragging still turns the camera.
      if (e.button === 0 && !this.locked && el.requestPointerLock && !(window as any).__noLock) {
        try { (el.requestPointerLock() as any)?.catch?.(() => {}); } catch { /* refused */ }
      }
    });
    const release = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.drawStick(); }
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    addEventListener('pointerup', (e) => { this.dragging = false; release(e); });
    addEventListener('pointercancel', (e) => { this.dragging = false; release(e); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (this.stick && e.pointerId === this.stick.id) { this.stick.x = e.clientX; this.stick.y = e.clientY; this.drawStick(); }
        else if (e.pointerId === this.lookId) {
          this.lookDelta.x += (e.clientX - this.lastLook.x) * 1.5; this.lookDelta.y += (e.clientY - this.lastLook.y) * 1.5;
          this.lastLook = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      if (this.locked || this.dragging) this.lookDelta.add(new THREE.Vector2(e.movementX, e.movementY));
    });
    el.addEventListener('wheel', (e) => { this.zoomDelta += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  private touchDown(e: PointerEvent) {
    this.enterTouchMode();
    if (e.clientX < innerWidth * 0.45 && !this.stick) {
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      this.drawStick();
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  }

  enterTouchMode() {
    if (this.touchMode) return;
    this.touchMode = true;
    const st = document.createElement('style');
    st.textContent = `
.kk-stick{position:fixed;width:${KeyboardMouseGamepad.STICK_R * 2}px;height:${KeyboardMouseGamepad.STICK_R * 2}px;margin:-${KeyboardMouseGamepad.STICK_R}px 0 0 -${KeyboardMouseGamepad.STICK_R}px;border-radius:50%;border:1px solid rgba(236,232,222,.45);background:rgba(20,22,22,.18);pointer-events:none;display:none;z-index:5}
.kk-knob{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(236,232,222,.42);pointer-events:none;display:none;z-index:5}
.kk-pad{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));display:grid;grid-template-columns:auto auto;gap:10px;align-items:end;z-index:6}
.kk-pad button{font:15px 'Cormorant Garamond',Georgia,serif;letter-spacing:.06em;color:#ece8de;background:rgba(20,22,22,.42);border:1px solid rgba(236,232,222,.4);border-radius:50%;width:62px;height:62px;padding:0;touch-action:none;-webkit-user-select:none;user-select:none}
.kk-pad button:active{background:rgba(236,232,222,.25)}
.kk-pad .act{width:76px;height:76px;font-size:17px}`;
    document.head.appendChild(st);
    this.stickEl = document.createElement('div'); this.stickEl.className = 'kk-stick';
    this.knobEl = document.createElement('div'); this.knobEl.className = 'kk-knob';
    const pad = document.createElement('div'); pad.className = 'kk-pad';
    pad.innerHTML = '<button data-c="KeyG" aria-label="Hint">Hint</button><button data-c="Tab" aria-label="Switch character">Switch</button><button data-c="KeyQ" aria-label="Companion waits or follows">Wait</button><button class="act" data-c="KeyE" aria-label="Interact">Act</button><span></span><button class="act" data-c="Space" aria-label="Jump">Jump</button>';
    pad.querySelectorAll('button').forEach((b) => {
      const code = (b as HTMLElement).dataset.c!;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        this.pressed.add(code); this.touchHeld.add(code);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => this.touchHeld.delete(code));
    });
    document.body.append(this.stickEl, this.knobEl, pad);
    for (const [code, text] of this.labels) this.label(code, text);
    this.onTouchMode?.();
  }

  // Renames an on-screen button (by its key code), or hides it with null.
  labels = new Map<string, string | null>();
  label(code: string, text: string | null) {
    this.labels.set(code, text);
    const b = document.querySelector<HTMLButtonElement>(`.kk-pad button[data-c="${code}"]`);
    if (!b) return;
    b.style.display = text === null ? 'none' : '';
    if (text) { b.textContent = text; b.setAttribute('aria-label', text); }
  }

  private drawStick() {
    if (!this.stickEl || !this.knobEl) return;
    const on = !!this.stick;
    this.stickEl.style.display = this.knobEl.style.display = on ? 'block' : 'none';
    if (!this.stick) return;
    const R = KeyboardMouseGamepad.STICK_R;
    let dx = this.stick.x - this.stick.x0, dy = this.stick.y - this.stick.y0;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.stickEl.style.left = `${this.stick.x0}px`; this.stickEl.style.top = `${this.stick.y0}px`;
    this.knobEl.style.left = `${this.stick.x0 + dx}px`; this.knobEl.style.top = `${this.stick.y0 + dy}px`;
  }

  poll(dt: number): InputFrame {
    const k = this.keys;
    const mv = new THREE.Vector2((k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0));
    if (mv.lengthSq() > 1) mv.normalize();
    if (this.stick) {
      const R = KeyboardMouseGamepad.STICK_R;
      const sx = (this.stick.x - this.stick.x0) / R, sy = (this.stick.y - this.stick.y0) / R;
      const m = Math.min(1, Math.hypot(sx, sy));
      if (m > 0.12) mv.set(sx, -sy).normalize().multiplyScalar((m - 0.12) / 0.88);
    }
    const look = new THREE.Vector2(-this.lookDelta.x * this.sensitivity, -this.lookDelta.y * this.sensitivity * (this.invertY ? -1 : 1));
    this.lookDelta.set(0, 0);
    const p = this.pressed;
    let sw = p.has('Tab'), inter = p.has('KeyE') || p.has('Enter'), wait = p.has('KeyQ'), reset = p.has('KeyR');
    let jump = p.has('Space'), hint = p.has('KeyG');
    let jumpHeld = k.has('Space') || this.touchHeld.has('Space');
    let skip = p.has('Space') || p.has('Escape') || p.has('Enter') || p.has('Pointer');
    let walk = k.has('ShiftLeft') || k.has('ShiftRight');
    // Gamepad: left stick move, right stick camera, A/Cross jump, X/Square interact, Y/Triangle switch,
    // B/Circle companion waits or follows, LB hint, hold RB to walk, Back reset.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((x) => x && x.connected);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
      if (Math.abs(lx) + Math.abs(ly) > 0) { mv.set(lx, -ly); if (mv.lengthSq() > 1) mv.normalize(); }
      const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
      look.x += -rx * 2.4 * dt; look.y += -ry * 1.6 * dt;
      const b = gp.buttons.map((x) => x.pressed);
      const edge = (i: number) => b[i] && !this.padPrev[i];
      if (edge(3)) sw = true;
      if (edge(0)) { jump = true; skip = true; }
      if (edge(2)) inter = true;
      if (edge(1)) wait = true;
      if (edge(4)) hint = true;
      if (edge(8)) reset = true;
      if (edge(9)) skip = true;
      if (b[5]) walk = true;
      if (b[0]) jumpHeld = true;
      this.padPrev = b;
    }
    const zoom = this.zoomDelta; this.zoomDelta = 0;
    const any = p.size > 0 || mv.lengthSq() > 0;
    p.clear();
    return { move: mv, look, walk, switchPressed: sw, interactPressed: inter, waitPressed: wait, resetPressed: reset, skipPressed: skip, jumpPressed: jump, jumpHeld, hintPressed: hint, zoom, any };
  }
}
