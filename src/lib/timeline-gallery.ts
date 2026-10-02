// Proximity-driven scatter conveyor.
// Items drift along a horizontal track. Approaching the center they scale up and
// scatter along the vertical axis; toward the edges they shrink back into a row.
// When an item wraps it is fully shrunk, so its randoms and content are re-rolled
// unseen. Auto-drifts, and wheel / drag on empty space push it around with momentum.
// Hovering (or tapping) a card flips it over to reveal a heading and text, and
// eases the conveyor to a stop until the pointer leaves.
// Dragging a card lifts it out of the conveyor and pins it wherever it's dropped,
// leaving a gap in the row; release it fast and it's thrown, bouncing off the
// edges. Double-clicking empty space collapses the whole conveyor into a heap.
// Double-click a pinned card (or call rebuild) to fly it back into its gap.
// Cards degrade (pixelate, desaturate) toward the edges and resolve to full
// fidelity at the center: ruined on the way in, rebuilt as they arrive.

export type GalleryItem = {
  src: string;
  kind: "image" | "video";
  caption?: string;
  // Back of the card, revealed on hover
  title?: string;
  text?: string;
};

export type GalleryOptions = {
  minCount: number;
  spacing: number;
  baseSize: number;
  centerScale: number;
  scaleZone: number;
  scatterSpread: number;
  scatterZone: number;
  edgeWidth: number;
  speed: number;
  randomness: number;
  widthVariation: number;
  heightVariation: number;
  captionSize: number;
  captionFont: string;
  captionColor: string;
  emptyColor: string;
  backColor: string;
  backTextColor: string;
  backFont: string;
  backMinSize: number;
  pinnedSize: number;
  ruinPixels: number;
  ruinGray: number;
};

// Tuned on a 1080x1350 reference canvas; pixel values are scaled to the viewport.
const DEFAULTS: GalleryOptions = {
  minCount: 11,
  spacing: 98,
  baseSize: 213,
  centerScale: 2.2,
  scaleZone: 250,
  scatterSpread: 330,
  scatterZone: 450,
  edgeWidth: 210,
  speed: 0.75,
  randomness: 0.01,
  widthVariation: 0.21,
  heightVariation: 0.49,
  captionSize: 27,
  captionFont: '"Instrument Serif", serif',
  captionColor: "#ffffff",
  emptyColor: "#1a1a1a",
  backColor: "#f1ede4",
  backTextColor: "#111111",
  backFont: '"Geist Mono", monospace',
  backMinSize: 300, // flipped cards grow to at least this width (reference px)
  pinnedSize: 320, // picked-up cards grow to at least this width (reference px)
  ruinPixels: 14, // largest pixel block at the edges (CSS px)
  ruinGray: 0.85, // how much color drains out at the edges (0..1)
};

const REF_W = 1080;
const REF_H = 1350;
const MIN_K = 0.45;
const FRICTION = 4; // velocity decay per second (exponential)
const MAX_VELOCITY = 80;
const FLIP_DURATION = 0.6; // seconds
const HOLD_RATE = 5; // how quickly the conveyor stops / resumes around a hover
const TAP_SLOP = 6; // px of movement before a press counts as a drag
const SETTLE_RATE = 12; // how quickly pinned cards ease to their size / tilt
const RETURN_DURATION = 0.9; // seconds for a pinned card to fly back into its gap
const RETURN_STAGGER = 0.09; // seconds between cards when rebuilding several
const RETURN_ARC = 60; // px (reference) a returning card arcs upward mid-flight
const MAX_TILT = 0.2; // radians of tilt while a card is dragged
const DROP_TILT = 0.06; // radians of random tilt a card settles at when dropped
const THROW_MIN = 600; // px/s release speed that turns a drop into a throw
const THROW_SPIN = 0.004; // rad/s of spin per px/s of horizontal throw speed
const MAX_SPIN = 12; // rad/s
const GRAVITY = 2600; // px/s² (reference), applied while collapsed
const RESTITUTION = 0.55; // bounce off the viewport edges
const TABLE_DRAG = 2.5; // a thrown card slides to a stop like a photo on a table
const AIR_DRAG = 0.15; // light drag while falling
const STOP_SPEED = 20; // px/s below which a thrown card stops
const REST_SPEED = 120; // px/s (reference) below which a falling card comes to rest
const PILE_OVERLAP = 0.45; // cards in the heap sink this far into the ones below
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;

type Slot = {
  type: "slot";
  index: number;
  content: number; // index into gallery
  scatter: number; // -1..1
  scaleVar: number; // -1..1
  lastCycle: number | null;
  vacant: boolean; // card was picked up; the gap is held until it's returned
  // per-frame layout
  x: number;
  y: number;
  w: number;
  h: number;
  dist: number;
  fScale: number;
  ruin: number; // 0 = full fidelity, 1 = fully degraded
  flip: number; // 0 = front, 1 = back (linear progress)
};

type Pinned = {
  type: "pinned";
  content: number;
  x: number; // center
  y: number;
  w: number;
  h: number;
  targetW: number;
  targetH: number;
  rot: number;
  targetRot: number;
  flip: number;
  origin: Slot | null; // gap in the conveyor this card returns to
  returning: { delay: number; t: number; from: Box } | null;
  // Physics, for thrown and collapsed cards (px/s, rad/s)
  vx: number;
  vy: number;
  spin: number;
  moving: boolean;
  resting: boolean; // settled on the heap
};

type Card = Slot | Pinned;

// Card placement in canvas space: center, size and rotation
type Box = { cx: number; cy: number; w: number; h: number; rot: number };

type Point = { x: number; y: number };

type Press = {
  target: Card | null;
  distance: number;
};

type Media = (HTMLImageElement | HTMLVideoElement) & { ready?: boolean; alpha?: number };

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rand = () => Math.random() * 2 - 1;
const hash = (n: number) => Math.abs(Math.sin(n) * 43758.5453) % 1;

export class TimelineGallery {
  private ctx: CanvasRenderingContext2D;
  private opts: GalleryOptions;
  private slots: Slot[] = [];
  private pinned: Pinned[] = []; // last is topmost
  private media = new Map<string, Media>();
  private queue = 0;

  private w = 0;
  private h = 0;
  private k = 1; // size scale (fits the reference canvas in the viewport)
  private kx = 1; // horizontal scale (track always spans the viewport width)
  private offset = 0;
  private velocity = 0;
  private drift: number;
  private lastTime = 0;
  private raf = 0;

  private press: Press | null = null;
  private scrubVelocity = 0;
  private held: Pinned | null = null; // card being dragged
  private grab: Point = { x: 0, y: 0 }; // pointer offset from the held card's center
  private heldVelocity: Point = { x: 0, y: 0 }; // px/s, smoothed
  private lastMoveTime = 0;
  private lastTap: { time: number; x: number; y: number } | null = null;

  private collapsed = false;
  private rebuilding: Promise<void> | null = null;
  private finishRebuild: (() => void) | null = null;
  private lastRuin = -1;

  private pointer: Point | null = null;
  private pointerIsTouch = false;
  private active: Card | null = null; // card currently flipped (or flipping) toward its back
  private tapped: Card | null = null; // touch: card toggled by a tap
  private hold = 0; // 0 = drifting, 1 = stopped for a hover
  private flipDuration = FLIP_DURATION;

  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private items: GalleryItem[],
    options: Partial<GalleryOptions> = {},
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.opts = { ...DEFAULTS, ...options };

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this.drift = reducedMotion.matches ? 0 : this.opts.speed;
    if (reducedMotion.matches) this.flipDuration = 0.001;

    this.resize();
    this.bindEvents();
    this.start();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((fn) => fn());
    this.media.forEach((m) => m instanceof HTMLVideoElement && m.pause());
  }

  // Share of the conveyor that's been wrecked: vacant slots / all slots (0..1)
  get ruinLevel() {
    if (!this.slots.length) return 0;
    return this.slots.filter((s) => s.vacant).length / this.slots.length;
  }

  // Fly every pinned card back into its gap, left to right. Resolves once the
  // last one lands; the conveyor then eases back into its drift.
  rebuild(): Promise<void> {
    if (this.rebuilding) return this.rebuilding;
    this.collapsed = false;
    this.held = null;
    if (!this.pinned.length) {
      this.restoreSlots();
      return Promise.resolve();
    }
    this.rebuilding = new Promise((resolve) => (this.finishRebuild = resolve));
    const waiting = this.pinned.filter((p) => !p.returning).sort((a, b) => a.x - b.x);
    for (const pin of this.pinned) {
      pin.moving = false;
      pin.resting = false;
    }
    waiting.forEach((pin, i) => this.startReturn(pin, i * RETURN_STAGGER));
    return this.rebuilding;
  }

  // Break the conveyor: every card drops out of the row and falls into a heap
  collapse() {
    if (this.collapsed || this.rebuilding) return;
    this.collapsed = true;
    this.velocity = 0;
    this.scrubVelocity = 0;
    this.active = null;
    this.tapped = null;

    for (const slot of this.slots) {
      if (slot.vacant) continue;
      if (slot.w < 4 || slot.h < 4) {
        // Too small to see; just leave the gap
        slot.vacant = true;
        continue;
      }
      const pin = this.pinFromSlot(slot, false);
      pin.vx = rand() * 120 * this.k;
      pin.vy = -(80 + Math.random() * 220) * this.k; // a small hop as the row gives way
      pin.spin = rand() * 3;
      pin.moving = true;
      this.pinned.push(pin);
    }
    for (const pin of this.pinned) {
      if (pin === this.held || pin.returning) continue;
      pin.moving = true;
      pin.resting = false;
    }
  }

  // --- Setup ------------------------------------------------------------------

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.k = Math.max(MIN_K, Math.min(this.w / REF_W, this.h / REF_H));
    this.kx = Math.max(this.k, this.w / REF_W);
    this.initSlots();
    for (const p of this.pinned) this.clampToViewport(p);
  }

  private initSlots() {
    const spacing = this.opts.spacing * this.kx;
    const count = Math.max(this.opts.minCount, Math.ceil(this.w / spacing) + 2);
    this.slots = Array.from({ length: count }, (_, i) => ({
      type: "slot",
      index: i,
      content: i % this.items.length,
      scatter: rand(),
      scaleVar: rand(),
      lastCycle: null,
      vacant: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      dist: 0,
      fScale: 0,
      ruin: 0,
      flip: 0,
    }));
    this.queue = count;
    // The old slots are gone; reserve fresh gaps for any cards still pinned
    const step = Math.max(1, Math.floor(count / Math.max(1, this.pinned.length)));
    this.pinned.forEach((pin, i) => {
      const slot = this.slots[(i * step) % count];
      if (slot.vacant) {
        pin.origin = null;
        return;
      }
      slot.vacant = true;
      slot.content = pin.content;
      pin.origin = slot;
    });
    if (this.collapsed) {
      // Keep the row broken, and let the heap settle again at the new size
      for (const slot of this.slots) slot.vacant = true;
      for (const pin of this.pinned) {
        if (pin.resting) {
          pin.resting = false;
          pin.moving = true;
        }
      }
    }
    if (this.active?.type === "slot") this.active = null;
    if (this.tapped?.type === "slot") this.tapped = null;
    if (this.press?.target?.type === "slot") this.press = null;
  }

  private bindEvents() {
    const on = (
      target: EventTarget,
      type: string,
      fn: (e: any) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.resize(), 100);
    });
    ro.observe(this.canvas);
    this.cleanup.push(() => ro.disconnect());

    on(window, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      // Wheel down / swipe left moves the conveyor forward (leftward)
      this.velocity = clamp(this.velocity + delta * 0.08, -MAX_VELOCITY, MAX_VELOCITY);
    }, { passive: false });

    const setPointer = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.pointerIsTouch = e.pointerType !== "mouse";
    };

    on(this.canvas, "pointerdown", (e: PointerEvent) => {
      setPointer(e);
      // Cards can't be grabbed mid-rewind
      const target = this.rebuilding ? null : this.hitTest(this.pointer);
      this.press = { target, distance: 0 };
      this.heldVelocity = { x: 0, y: 0 };
      this.lastMoveTime = e.timeStamp;
      this.scrubVelocity = 0;
      if (!target) this.velocity = 0;
      this.canvas.setPointerCapture(e.pointerId);
    });

    on(this.canvas, "pointermove", (e: PointerEvent) => {
      // Deltas come from positions: movementX isn't reliable for touch everywhere
      const prev = this.pointer;
      setPointer(e);
      const press = this.press;
      if (!press || !prev || !this.pointer) return;
      const dx = this.pointer.x - prev.x;
      const dy = this.pointer.y - prev.y;
      press.distance += Math.abs(dx) + Math.abs(dy);
      if (press.distance < TAP_SLOP) return;
      this.canvas.classList.add("is-dragging");

      if (press.target) {
        if (!this.held) this.pickUp(press.target);
        this.moveHeld(dx, dy, e.timeStamp);
      } else {
        // Dragging left moves items left, matching the drift direction
        this.offset -= dx;
        this.scrubVelocity = this.scrubVelocity * 0.6 - dx * 0.4;
      }
    });

    const release = (e: PointerEvent) => {
      const press = this.press;
      if (!press) return;
      this.press = null;
      this.canvas.releasePointerCapture?.(e.pointerId);
      this.canvas.classList.remove("is-dragging");

      if (this.held) {
        this.release(this.held, e.timeStamp);
      } else if (press.distance < TAP_SLOP) {
        if (this.pointerIsTouch && this.pointer) {
          // Touch has no dblclick: detect a double tap ourselves
          const { x, y } = this.pointer;
          const last = this.lastTap;
          const isDouble =
            last &&
            e.timeStamp - last.time < DOUBLE_TAP_MS &&
            Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_DIST;
          this.lastTap = isDouble ? null : { time: e.timeStamp, x, y };
          if (isDouble) this.doubleActivate(press.target);
          // A single tap toggles the card under the finger
          else this.tapped = press.target && press.target !== this.tapped ? press.target : null;
        }
      } else {
        this.velocity = clamp(this.scrubVelocity, -MAX_VELOCITY, MAX_VELOCITY);
        this.tapped = null;
      }
    };
    on(this.canvas, "pointerup", release);
    on(this.canvas, "pointercancel", release);
    on(this.canvas, "pointerleave", (e: PointerEvent) => {
      if (e.pointerType === "mouse") this.pointer = null;
    });

    on(this.canvas, "dblclick", () => {
      if (this.pointerIsTouch) return; // handled as a double tap
      this.doubleActivate(this.hitTest(this.pointer));
    });

    on(document, "visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(this.raf);
      else this.start();
    });
  }

  private start() {
    cancelAnimationFrame(this.raf);
    this.lastTime = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  // --- Pinning ----------------------------------------------------------------

  // Double-click / double-tap: a pinned card goes home, empty space collapses the row
  private doubleActivate(hit: Card | null) {
    if (hit?.type === "pinned" && !hit.returning) this.startReturn(hit, 0);
    else if (!hit) this.collapse();
  }

  // Turn a conveyor slot's card into a free card, leaving its gap reserved
  private pinFromSlot(slot: Slot, grow: boolean): Pinned {
    const box = this.boxFor(slot);
    const minW = this.opts.pinnedSize * this.k;
    const scale = grow ? Math.max(1, minW / Math.max(box.w, 1)) : 1;
    const pin: Pinned = {
      type: "pinned",
      content: slot.content,
      x: box.cx,
      y: box.cy,
      w: box.w,
      h: box.h,
      targetW: box.w * scale,
      targetH: box.h * scale,
      rot: 0,
      targetRot: 0,
      flip: slot.flip,
      origin: slot,
      returning: null,
      vx: 0,
      vy: 0,
      spin: 0,
      moving: false,
      resting: false,
    };
    slot.vacant = true;
    slot.flip = 0;
    if (this.tapped === slot) this.tapped = pin;
    return pin;
  }

  // Lift a card out of the conveyor (or raise an already-pinned one) and hold it
  private pickUp(card: Card) {
    let pin: Pinned;
    if (card.type === "pinned") {
      pin = card;
      this.pinned.splice(this.pinned.indexOf(pin), 1);
      pin.moving = false;
      pin.resting = false;
    } else {
      pin = this.pinFromSlot(card, true);
    }
    this.pinned.push(pin);
    this.held = pin;
    this.press!.target = pin;
    const p = this.pointer ?? { x: pin.x, y: pin.y };
    this.grab = { x: p.x - pin.x, y: p.y - pin.y };
  }

  private moveHeld(dx: number, dy: number, time: number) {
    const pin = this.held;
    if (!pin || !this.pointer) return;
    pin.x = this.pointer.x - this.grab.x;
    pin.y = this.pointer.y - this.grab.y;
    this.clampToViewport(pin);
    // Tilt into the direction of travel, like a photo picked up by one corner
    pin.targetRot = clamp(pin.targetRot * 0.7 + dx * 0.012, -MAX_TILT, MAX_TILT);

    // Track release velocity for throws
    const elapsed = (time - this.lastMoveTime) / 1000;
    this.lastMoveTime = time;
    if (elapsed > 0) {
      const v = this.heldVelocity;
      v.x = lerp(v.x, dx / elapsed, 0.5);
      v.y = lerp(v.y, dy / elapsed, 0.5);
    }
  }

  // Let go of the held card: a fast release throws it, a slow one drops it
  private release(pin: Pinned, time: number) {
    this.held = null;
    // A pause before letting go means it was placed, not thrown
    const paused = time - this.lastMoveTime > 80;
    const v = paused ? { x: 0, y: 0 } : this.heldVelocity;
    if (Math.hypot(v.x, v.y) > THROW_MIN) {
      pin.vx = v.x;
      pin.vy = v.y;
      pin.spin = clamp(v.x * THROW_SPIN, -MAX_SPIN, MAX_SPIN);
      pin.moving = true;
    } else {
      pin.targetRot = rand() * DROP_TILT;
      // While collapsed, anything let go falls back onto the heap
      if (this.collapsed) {
        pin.vx = pin.vy = pin.spin = 0;
        pin.moving = true;
      }
    }
  }

  // Keep at least part of a card on screen so it can always be grabbed again
  private clampToViewport(pin: Pinned) {
    const mx = Math.min(pin.targetW / 2, this.w / 2);
    const my = Math.min(pin.targetH / 2, this.h / 2);
    pin.x = clamp(pin.x, mx * 0.25, this.w - mx * 0.25);
    pin.y = clamp(pin.y, my * 0.25, this.h - my * 0.25);
  }

  private startReturn(pin: Pinned, delay: number) {
    if (this.held === pin) this.held = null;
    pin.returning = {
      delay,
      t: 0,
      from: { cx: pin.x, cy: pin.y, w: pin.w, h: pin.h, rot: pin.rot },
    };
    pin.moving = false;
    pin.resting = false;
  }

  private updatePinned(dt: number) {
    const ease = 1 - Math.exp(-SETTLE_RATE * dt);
    let landed = false;
    for (const pin of this.pinned) {
      const r = pin.returning;
      if (r) {
        if (r.delay > 0) r.delay -= dt;
        else r.t = Math.min(1, r.t + dt / RETURN_DURATION);
        if (r.t >= 1) {
          // Drop back into the gap; the slot takes over drawing seamlessly
          if (pin.origin) {
            pin.origin.vacant = false;
            pin.origin.content = pin.content;
            pin.origin.flip = 0;
          }
          landed = true;
        }
        continue;
      }
      pin.w += (pin.targetW - pin.w) * ease;
      pin.h += (pin.targetH - pin.h) * ease;
      if (pin === this.held) {
        // A held card's tilt relaxes back toward level when the pointer pauses
        pin.targetRot *= Math.exp(-6 * dt);
        pin.rot += (pin.targetRot - pin.rot) * ease;
      } else if (pin.moving) {
        this.stepPhysics(pin, dt);
      } else {
        pin.rot += (pin.targetRot - pin.rot) * ease;
      }
    }
    if (landed) {
      this.pinned = this.pinned.filter((p) => !p.returning || p.returning.t < 1);
      if (this.active?.type === "pinned" && !this.pinned.includes(this.active)) this.active = null;
      if (this.tapped?.type === "pinned" && !this.pinned.includes(this.tapped)) this.tapped = null;
      if (this.rebuilding && !this.pinned.length) {
        this.restoreSlots();
        this.rebuilding = null;
        this.finishRebuild?.();
        this.finishRebuild = null;
      }
    }
  }

  // Gaps left with no card to return to (e.g. tiny edge slots during a collapse)
  // simply fill back in
  private restoreSlots() {
    const reserved = new Set(this.pinned.map((p) => p.origin));
    for (const slot of this.slots) if (slot.vacant && !reserved.has(slot)) slot.vacant = false;
  }

  // Rotated card's axis-aligned half extents
  private extents(pin: Pinned) {
    const c = Math.abs(Math.cos(pin.rot));
    const s = Math.abs(Math.sin(pin.rot));
    return { hw: (pin.w * c + pin.h * s) / 2, hh: (pin.w * s + pin.h * c) / 2 };
  }

  // Where a falling card stops: the viewport floor, or the top of the heap
  // beneath it (cards sink partway into the ones below so the pile looks loose).
  // Only cards it was above count, so one beside another doesn't jump on top.
  private floorFor(pin: Pinned, hw: number, prevBottom: number) {
    let floor = this.h;
    for (const other of this.pinned) {
      if (other === pin || !other.resting) continue;
      const o = this.extents(other);
      if (Math.abs(other.x - pin.x) >= hw + o.hw) continue;
      const top = other.y - o.hh + o.hh * 2 * PILE_OVERLAP;
      if (top < prevBottom - 1) continue;
      floor = Math.min(floor, top);
    }
    return floor;
  }

  private stepPhysics(pin: Pinned, dt: number) {
    const falling = this.collapsed;
    if (falling) pin.vy += GRAVITY * this.k * dt;
    const drag = Math.exp(-(falling ? AIR_DRAG : TABLE_DRAG) * dt);
    pin.vx *= drag;
    pin.vy *= drag;
    pin.spin *= Math.exp(-(falling ? 0.5 : 3) * dt);

    const prevBottom = pin.y + this.extents(pin).hh;
    pin.x += pin.vx * dt;
    pin.y += pin.vy * dt;
    pin.rot += pin.spin * dt;
    pin.targetRot = pin.rot;

    // Bounce off the viewport edges. Only reverse when heading into a wall, so a
    // card released partly off-screen drifts back rather than snapping in.
    const { hw, hh } = this.extents(pin);
    if ((pin.x - hw < 0 && pin.vx < 0) || (pin.x + hw > this.w && pin.vx > 0)) {
      pin.vx = -pin.vx * RESTITUTION;
      pin.spin *= -0.5;
    }
    if (pin.y - hh < 0 && pin.vy < 0) {
      pin.vy = -pin.vy * RESTITUTION;
    }

    const floor = falling ? this.floorFor(pin, hw, prevBottom) : this.h;
    if (pin.y + hh > floor && pin.vy > 0) {
      if (!falling) {
        pin.vy = -pin.vy * RESTITUTION;
      } else {
        pin.y = floor - hh;
        if (pin.vy < REST_SPEED * this.k) {
          // Come to rest, easing toward lying flat
          pin.vx = pin.vy = pin.spin = 0;
          pin.moving = false;
          pin.resting = true;
          const flat = Math.round(pin.rot / (Math.PI / 2)) * (Math.PI / 2);
          pin.targetRot = flat + rand() * 0.1;
        } else {
          pin.vy = -pin.vy * 0.3;
          pin.vx *= 0.7;
          pin.spin *= 0.6;
        }
      }
    }

    if (!falling && Math.hypot(pin.vx, pin.vy) < STOP_SPEED) {
      pin.moving = false;
      pin.vx = pin.vy = pin.spin = 0;
    }
  }

  private emitRuin() {
    const level = this.ruinLevel;
    if (Math.abs(level - this.lastRuin) < 1e-4) return;
    this.lastRuin = level;
    this.canvas.dispatchEvent(
      new CustomEvent("gallery:ruin", { detail: { level }, bubbles: true }),
    );
  }

  // Next gallery item for a wrapping slot, skipping ones currently pinned
  private nextContent() {
    const pinned = new Set(this.pinned.map((p) => p.content));
    for (let i = 0; i < this.items.length; i++) {
      const c = this.queue++ % this.items.length;
      if (!pinned.has(c)) return c;
    }
    return this.queue++ % this.items.length;
  }

  // --- Media ------------------------------------------------------------------

  private getMedia(item: GalleryItem): Media | undefined {
    let m = this.media.get(item.src);
    if (m) return m;

    if (item.kind === "video") {
      const video: Media = document.createElement("video");
      Object.assign(video, { muted: true, loop: true, playsInline: true, autoplay: true });
      video.onloadeddata = () => (video.ready = true);
      video.src = item.src;
      video.play().catch(() => {});
      m = video;
    } else {
      const img: Media = new Image();
      img.decoding = "async";
      img.onload = () => (img.ready = true);
      img.src = item.src;
      m = img;
    }
    m.alpha = 0;
    this.media.set(item.src, m);
    return m;
  }

  // --- Frame ------------------------------------------------------------------

  private frame = (time: number) => {
    const dt = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;

    // Ease the drift to a stop while a conveyor card is shown, and back up after
    // Also stays stopped while collapsed and during a rewind
    const holdTarget =
      this.active?.type === "slot" || this.collapsed || this.rebuilding ? 1 : 0;
    this.hold += (holdTarget - this.hold) * (1 - Math.exp(-HOLD_RATE * dt));

    const scrubbing = this.press && !this.press.target && this.press.distance >= TAP_SLOP;
    if (!scrubbing) {
      this.velocity *= Math.exp(-FRICTION * dt);
      if (Math.abs(this.velocity) < 0.01) this.velocity = 0;
      this.offset += (this.drift * (1 - this.hold) + this.velocity) * dt * 60 * this.kx;
    }

    this.layout();
    this.updatePinned(dt);
    this.updateFlip(dt);
    this.render(dt);
    this.emitRuin();
    this.raf = requestAnimationFrame(this.frame);
  };

  private layout() {
    const o = this.opts;
    const { k, kx } = this;
    const spacing = o.spacing * kx;
    const total = this.slots.length * spacing;
    const half = total / 2;
    const edgeWidth = o.edgeWidth * kx;
    const scaleZone = o.scaleZone * kx;
    const scatterZone = o.scatterZone * kx;
    const cx = this.w / 2;
    const cy = this.h / 2;

    for (const s of this.slots) {
      // Items move right-to-left, so subtract the offset
      const logical = s.index * spacing - this.offset;
      const rel = mod(logical + half, total) - half;
      const cycle = Math.floor((logical + half) / total);

      if (s.lastCycle !== cycle) {
        if (s.lastCycle !== null) {
          s.scatter = rand();
          s.scaleVar = rand();
          s.flip = 0;
          // A reserved gap keeps its content for the pinned card to return to
          if (!s.vacant) s.content = this.nextContent();
          if (this.tapped === s) this.tapped = null;
        }
        s.lastCycle = cycle;
      }

      const fromStart = rel + half;
      const fromEnd = half - rel;
      let edgeScale = 1;
      if (fromStart < edgeWidth) edgeScale = smoothstep(Math.max(0, fromStart / edgeWidth));
      else if (fromEnd < edgeWidth) edgeScale = smoothstep(Math.max(0, fromEnd / edgeWidth));

      const dist = Math.abs(rel);
      const fScale = dist < scaleZone ? smoothstep(1 - dist / scaleZone) : 0;
      const fScatter = dist < scatterZone ? 1 - smoothstep(dist / scatterZone) : 0;

      const scale =
        edgeScale *
        (1 + (o.centerScale - 1) * fScale + s.scaleVar * o.randomness * 0.3 * fScale);
      const wVar = 1 + (hash(s.index * 12.9898) * 2 - 1) * o.widthVariation * 0.5;
      const hVar = 1 + (hash(s.index * 78.233) * 2 - 1) * o.heightVariation * 0.5;

      s.w = o.baseSize * k * wVar * scale;
      s.h = o.baseSize * k * hVar * scale;
      s.x = cx + rel - s.w / 2;
      s.y = cy + s.scatter * o.scatterSpread * k * 0.5 * fScatter - s.h / 2;
      s.dist = dist;
      s.fScale = fScale;

      // Full fidelity through the center, degrading out to the viewport edges
      const clear = scaleZone * 0.5;
      const reach = Math.max(1, this.w / 2 - clear);
      s.ruin = smoothstep(clamp((dist - clear) / reach, 0, 1));
    }
  }

  // --- Hover / flip -----------------------------------------------------------

  private boxFor(card: Card): Box {
    if (card.type === "pinned") {
      const r = card.returning;
      if (!r) return { cx: card.x, cy: card.y, w: card.w, h: card.h, rot: card.rot };
      // Fly from where it was dropped into its (moving) gap, arcing up on the way
      const to: Box = card.origin
        ? this.boxFor(card.origin)
        : { ...r.from, w: 0, h: 0 };
      const e = easeInOutCubic(r.t);
      return {
        cx: lerp(r.from.cx, to.cx, e),
        cy: lerp(r.from.cy, to.cy, e) - Math.sin(Math.PI * e) * RETURN_ARC * this.k,
        w: lerp(r.from.w, to.w, e),
        h: lerp(r.from.h, to.h, e),
        rot: lerp(r.from.rot, 0, e),
      };
    }
    // Conveyor cards get a lift while flipped so their back stays readable
    const t = easeInOutCubic(card.flip);
    const min = this.opts.backMinSize * this.k;
    const lift = 1 + Math.max(0, min / Math.max(card.w, 1) - 1) * t;
    return {
      cx: card.x + card.w / 2,
      cy: card.y + card.h / 2,
      w: card.w * lift,
      h: card.h * lift,
      rot: 0,
    };
  }

  private visible(card: Card) {
    if (card.type === "pinned") return true;
    return !card.vacant && card.w >= 0.5 && card.h >= 0.5;
  }

  // Topmost card under the point. The active card is drawn on top, so it wins.
  private hitTest(p: Point | null): Card | null {
    if (!p) return null;
    const inside = (card: Card) => {
      if (!this.visible(card)) return false;
      if (card.type === "pinned" && card.returning) return false;
      const b = this.boxFor(card);
      // Undo the card's rotation to test against an axis-aligned rect
      const dx = p.x - b.cx;
      const dy = p.y - b.cy;
      const cos = Math.cos(-b.rot);
      const sin = Math.sin(-b.rot);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
    };
    if (this.active && inside(this.active)) return this.active;
    const ordered = this.zOrder();
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (inside(ordered[i])) return ordered[i];
    }
    return null;
  }

  private updateFlip(dt: number) {
    if (this.held) {
      // A card being carried shows its front
      this.active = null;
    } else if (this.pointerIsTouch) {
      this.active = this.tapped;
    } else {
      const scrubbing = this.press && this.press.distance >= TAP_SLOP;
      this.active = scrubbing ? null : this.hitTest(this.pointer);
    }

    const step = dt / this.flipDuration;
    const all: Card[] = [...this.slots, ...this.pinned];
    for (const card of all) {
      const target = card === this.active ? 1 : 0;
      card.flip = target ? Math.min(1, card.flip + step) : Math.max(0, card.flip - step);
    }
  }

  // Bottom to top: conveyor (farthest from center first, flipping cards above),
  // then pinned cards in the order they were dropped, then the active card
  private zOrder(): Card[] {
    const slots = [...this.slots].sort((a, b) => {
      if (a === this.active) return 1;
      if (b === this.active) return -1;
      if (a.flip !== b.flip) return a.flip - b.flip;
      return b.dist - a.dist;
    });
    const pinned = [...this.pinned].sort((a, b) => {
      if (a === this.held) return 1;
      if (b === this.held) return -1;
      if (a === this.active) return 1;
      if (b === this.active) return -1;
      return 0;
    });
    return [...slots, ...pinned];
  }

  // --- Render -----------------------------------------------------------------

  private render(dt: number) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);

    for (const card of this.zOrder()) {
      if (!this.visible(card)) continue;
      const item = this.items[card.content];
      const b = this.boxFor(card);
      if (b.w < 0.5 || b.h < 0.5) continue;
      const t = easeInOutCubic(card.flip);

      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(b.rot);

      // Caption above the card: near the center for conveyor cards, always for pinned
      const back = card.type === "pinned" ? this.returnProgress(card) : 0;
      const captionAlpha =
        card.type === "pinned"
          ? lerp(1, card.origin?.fScale ?? 0, back)
          : Math.max(card.fScale, t);
      this.drawCaption(item, b.w, b.h, captionAlpha);

      // Fake a 3D turn around the vertical axis: squash X through the edge-on
      // midpoint, swap faces there, and swell Y slightly for perspective.
      const turn = Math.cos(Math.PI * t);
      ctx.scale(Math.max(Math.abs(turn), 0.001), 1 + 0.06 * Math.sin(Math.PI * t));
      ctx.translate(-b.w / 2, -b.h / 2);

      if (card.type === "pinned") {
        // Lifted cards cast a shadow onto the conveyor
        ctx.shadowColor = `rgba(0,0,0,${0.55 * (1 - back)})`;
        ctx.shadowBlur = card === this.held ? 40 : 24;
        ctx.shadowOffsetY = card === this.held ? 18 : 10;
        ctx.fillStyle = this.opts.emptyColor;
        ctx.fillRect(0, 0, b.w, b.h);
        ctx.shadowColor = "transparent";
      }

      if (turn < 0) this.drawBack(item, card.content, b.w, b.h);
      else {
        // Pinned cards are pristine, picking up their gap's wear as they return;
        // flipping a card restores it too
        const ruin = card.type === "pinned" ? (card.origin?.ruin ?? 0) * back : card.ruin;
        this.drawFront(item, b.w, b.h, dt, ruin * (1 - t));
      }

      // Shade toward edge-on so the turn reads as depth
      if (t > 0 && t < 1) {
        ctx.fillStyle = `rgba(0,0,0,${0.45 * Math.sin(Math.PI * t)})`;
        ctx.fillRect(0, 0, b.w, b.h);
      }
      ctx.restore();
    }
  }

  private returnProgress(pin: Pinned) {
    return pin.returning ? easeInOutCubic(pin.returning.t) : 0;
  }

  private drawFront(item: GalleryItem, w: number, h: number, dt: number, ruin: number) {
    const { ctx, opts } = this;
    const m = this.getMedia(item);
    const srcW = m instanceof HTMLVideoElement ? m.videoWidth : m?.naturalWidth;
    const srcH = m instanceof HTMLVideoElement ? m.videoHeight : m?.naturalHeight;
    const loaded = m?.ready && srcW && srcH;

    if (!loaded || (m.alpha ?? 0) < 0.99) {
      ctx.fillStyle = opts.emptyColor;
      ctx.fillRect(0, 0, w, h);
    }
    if (!loaded) return;

    m.alpha = Math.min(1, (m.alpha ?? 0) + dt * 3);
    // Cover-fit crop
    const srcAspect = srcW / srcH;
    const cellAspect = w / h;
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAspect > cellAspect) {
      sw = srcH * cellAspect;
      sx = (srcW - sw) / 2;
    } else {
      sh = srcW / cellAspect;
      sy = (srcH - sh) / 2;
    }
    ctx.save();
    ctx.globalAlpha = m.alpha;

    // Pixel blocks snap to whole sizes so the degradation steps rather than swims
    const px = Math.round(1 + ruin * (opts.ruinPixels - 1));
    if (ruin > 0.02) {
      ctx.filter = `grayscale(${ruin * opts.ruinGray}) contrast(${1 + ruin * 0.3})`;
    }
    if (px >= 2) {
      // Downsample into a scratch canvas, then scale back up without smoothing
      const lw = Math.max(1, Math.ceil(w / px));
      const lh = Math.max(1, Math.ceil(h / px));
      const scratch = this.scratchCanvas(lw, lh);
      scratch.clearRect(0, 0, lw, lh);
      scratch.drawImage(m, sx, sy, sw, sh, 0, 0, lw, lh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch.canvas, 0, 0, lw, lh, 0, 0, w, h);
    } else {
      ctx.drawImage(m, sx, sy, sw, sh, 0, 0, w, h);
    }
    ctx.restore();
  }

  private scratch: CanvasRenderingContext2D | null = null;

  private scratchCanvas(w: number, h: number) {
    if (!this.scratch) this.scratch = document.createElement("canvas").getContext("2d")!;
    const c = this.scratch.canvas;
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
    return this.scratch;
  }

  private drawBack(item: GalleryItem, content: number, w: number, h: number) {
    const { ctx, opts } = this;
    ctx.fillStyle = opts.backColor;
    ctx.fillRect(0, 0, w, h);

    const pad = Math.max(10, w * 0.08);
    const innerW = w - pad * 2;
    const titleSize = clamp(w * 0.11, 14, 44);
    const bodySize = clamp(w * 0.04, 9, 13);
    const bodyLead = bodySize * 1.5;

    ctx.fillStyle = opts.backTextColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Index label, bottom-left
    ctx.font = `${bodySize}px ${opts.backFont}`;
    ctx.globalAlpha = 0.5;
    const label = `NO. ${String(content + 1).padStart(2, "0")}`;
    ctx.fillText(label, pad, h - pad - bodySize);
    ctx.globalAlpha = 1;
    const bottomLimit = h - pad - bodySize * 2.5;

    // Heading
    let y = pad;
    ctx.font = `${titleSize}px ${opts.captionFont}`;
    const title = item.title ?? item.caption ?? "";
    const titleLines = fitLines(ctx, wrapLines(ctx, title, innerW), 2, innerW);
    for (const line of titleLines) {
      ctx.fillText(line, pad, y);
      y += titleSize * 0.95;
    }

    // Body text, truncated to the space above the index label
    if (!item.text) return;
    y += titleSize * 0.4;
    ctx.font = `${bodySize}px ${opts.backFont}`;
    const maxLines = Math.floor((bottomLimit - y) / bodyLead);
    if (maxLines < 1) return;
    const bodyLines = fitLines(ctx, wrapLines(ctx, item.text, innerW), maxLines, innerW);
    for (const line of bodyLines) {
      ctx.fillText(line, pad, y);
      y += bodyLead;
    }
  }

  // Drawn in the card's (rotated, centered) space, just above its top-left corner
  private drawCaption(item: GalleryItem, w: number, h: number, alpha: number) {
    if (!item.caption || alpha <= 0.02) return;
    const { ctx, opts } = this;
    const size = Math.max(12, opts.captionSize * this.k);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = opts.captionColor;
    ctx.font = `${size}px ${opts.captionFont}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(item.caption, -w / 2, -h / 2 - size * 0.3);
    ctx.restore();
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Keep at most `max` lines, ending the last with an ellipsis if text was cut
function fitLines(ctx: CanvasRenderingContext2D, lines: string[], max: number, maxWidth: number) {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && ctx.measureText(last + "…").width > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[max - 1] = last + "…";
  return kept;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
