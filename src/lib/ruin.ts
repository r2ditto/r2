// Ties the site's ruin together: the gallery's wrecked share and the fallen
// letters make up a single "% ruined", shown on the Rebuild button, and
// Rebuild plays everything back in one staged rewind.

import type { Crumble } from "@lib/crumble";

export type RuinableGallery = HTMLElement & {
  rebuild(): Promise<void>;
  readonly ruinLevel: number;
};

type Options = {
  gallery: RuinableGallery | null;
  crumbles: Crumble[];
  button: HTMLButtonElement | null;
  poster: HTMLElement | null;
};

const TEXT_DELAY = 400; // ms after the cards start flying home
const TEXT_STAGGER = 120; // ms between text groups

export function initRuin({ gallery, crumbles, button, poster }: Options) {
  let galleryLevel = gallery?.ruinLevel ?? 0;
  let rewinding = false;
  let wasTotal = false;

  const totalGlyphs = crumbles.reduce((n, c) => n + c.totalGlyphs, 0) || 1;

  const percent = () => {
    const fallen = crumbles.reduce((n, c) => n + c.fallenGlyphs, 0);
    const level = 0.5 * galleryLevel + 0.5 * (fallen / totalGlyphs);
    if (level <= 0) return 0;
    return Math.max(1, Math.round(level * 100));
  };

  const update = () => {
    if (!button) return;
    const pct = percent();
    const total = pct >= 100;
    button.hidden = pct === 0 && !rewinding;
    button.classList.toggle("is-total", total);
    button.textContent = total ? "Totally ruined — Rebuild" : `Rebuild — ${pct}% ruined`;

    // One shake when everything is broken; re-arms once something is restored
    if (total && !wasTotal) shake();
    wasTotal = total;
  };

  const shake = () => {
    if (!poster) return;
    poster.classList.remove("is-shaking");
    void poster.offsetWidth; // restart the animation
    poster.classList.add("is-shaking");
  };
  poster?.addEventListener("animationend", () => poster.classList.remove("is-shaking"));

  gallery?.addEventListener("gallery:ruin", (e) => {
    galleryLevel = (e as CustomEvent<{ level: number }>).detail.level;
    update();
  });

  // Staged rewind: cards fly home first, then the letters spring back in the
  // reverse of the order they fell
  const rebuildAll = async () => {
    if (rewinding) return;
    rewinding = true;
    crumbles.forEach((c) => (c.locked = true));
    update();

    const cards = gallery?.rebuild() ?? Promise.resolve();
    const fallen = crumbles
      .filter((c) => c.state === "falling" || c.state === "fallen")
      .sort((a, b) => b.fallOrder - a.fallOrder);
    const text = fallen.map(
      (c, i) =>
        new Promise<void>((resolve) =>
          setTimeout(() => c.rebuild().then(resolve), TEXT_DELAY + i * TEXT_STAGGER),
        ),
    );

    await Promise.all([cards, ...text]);
    crumbles.forEach((c) => (c.locked = false));
    rewinding = false;
    update();
  };

  button?.addEventListener("click", rebuildAll);
  update();

  // Crumbles report changes through this
  return { update };
}
