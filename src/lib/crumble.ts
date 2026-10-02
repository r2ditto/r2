// Letters that crumble to the floor of the viewport on hover and stay there
// until rebuilt. Pairs with src/components/Crumble.astro.

type State = "intact" | "falling" | "fallen" | "rebuilding";

const GRAVITY = 3000; // px/s²
const FLOOR_SCATTER = 12; // px of random height letters come to rest at above the floor
const NEAR_FLOOR = 24; // px; glyphs this close to the floor just hop and tip over

let fallCounter = 0;

export class Crumble {
  state: State = "intact";
  locked = false; // ignore hovers (e.g. during a rewind)
  fallOrder = 0; // increases with each fall, so a rewind can run in reverse
  readonly glyphs: HTMLElement[];

  private falling: Promise<void> | null = null;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    readonly el: HTMLElement,
    private onChange: () => void,
  ) {
    this.glyphs = [...el.querySelectorAll<HTMLElement>(".glyph")];
    el.addEventListener("pointerenter", () => this.fall());
  }

  get totalGlyphs() {
    return this.glyphs.length;
  }

  get fallenGlyphs() {
    return this.state === "falling" || this.state === "fallen" ? this.glyphs.length : 0;
  }

  fall() {
    if (this.state !== "intact" || this.locked || this.reducedMotion) return;
    this.state = "falling";
    this.fallOrder = ++fallCounter;
    this.onChange();

    const floor = window.innerHeight;
    const animations = this.glyphs.map((glyph, i) => {
      const rect = glyph.getBoundingClientRect();
      const rest = floor - rand(0, FLOOR_SCATTER);
      let dy = rest - rect.bottom;
      let dx = rand(-40, 40);
      if (dy < NEAR_FLOOR) {
        // Already on the floor: hop a little and tip over
        dy = Math.max(0, dy) + rand(2, 8);
        dx = rand(-12, 12);
      }
      const rot = rand(-90, 90);
      const fallen = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      const bounce = `translate(${dx}px, ${dy - Math.min(24, dy * 0.08)}px) rotate(${rot * 0.9}deg)`;
      const duration = clamp(Math.sqrt((2 * Math.max(dy, 1)) / GRAVITY) * 1000, 350, 1100) * 1.25;

      return glyph.animate(
        [
          // Ease-in like gravity, then a small bounce on landing
          { transform: "none", easing: "cubic-bezier(.55, 0, 1, .45)" },
          { transform: fallen, offset: 0.8, easing: "ease-out" },
          { transform: bounce, offset: 0.9, easing: "ease-in" },
          { transform: fallen },
        ],
        { duration, delay: i * 18 + rand(0, 120), fill: "forwards" },
      );
    });

    this.falling = Promise.all(animations.map((a) => a.finished)).then(() => {
      // Hand the resting pose to inline styles so the rebuild can animate from it
      animations.forEach((a) => {
        a.commitStyles();
        a.cancel();
      });
      this.state = "fallen";
      this.falling = null;
    });
  }

  // Spring the letters back into place. Waits for a fall still in progress.
  async rebuild() {
    if (this.falling) await this.falling;
    if (this.state !== "fallen") return;
    this.state = "rebuilding";
    this.onChange();

    const animations = this.glyphs.map((glyph, i) =>
      glyph.animate(
        [{ transform: glyph.style.transform || "none" }, { transform: "none" }],
        {
          duration: 800,
          delay: i * 25,
          easing: "cubic-bezier(.34, 1.56, .64, 1)", // spring back with overshoot
          fill: "forwards",
        },
      ),
    );
    await Promise.all(animations.map((a) => a.finished));
    this.glyphs.forEach((glyph) => (glyph.style.transform = ""));
    animations.forEach((a) => a.cancel());
    this.state = "intact";
    this.onChange();
  }
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
