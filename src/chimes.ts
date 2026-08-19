import { playChime, setPaletteBrightness } from "./audio";

interface Chime {
  button: HTMLButtonElement;
  midi: number;
  duration: number;
}

// Bigger chimes (longer tubes, in the markup) ring lower and longer, like a
// real wind chime -- size hints at pitch, so no menu is needed to find it.
function durationForIndex(index: number, count: number): number {
  const longest = 2.2;
  const shortest = 0.8;
  const t = index / (count - 1);
  return longest - t * (longest - shortest);
}

function ring(chime: Chime): void {
  playChime(chime.midi, chime.duration);
  chime.button.classList.add("ringing");
  window.setTimeout(() => {
    chime.button.classList.remove("ringing");
  }, chime.duration * 1000);
}

export function initChimes(root: ParentNode): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".chime"));
  const chimes: Chime[] = buttons.map((button, index) => ({
    button,
    midi: Number(button.dataset.midi),
    duration: durationForIndex(index, buttons.length),
  }));

  // `pointerdown` fires the instant a mouse/finger/pen touches down --
  // unlike `click`, which waits for release, and would otherwise delay the
  // sound by however long the press is held. Enter/Space still need their
  // own keydown handling since neither is a pointer event.
  for (const chime of chimes) {
    chime.button.addEventListener("pointerdown", () => ring(chime));
    chime.button.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        ring(chime);
      }
    });
  }

  const keyToChime = new Map<string, Chime>();
  for (const chime of chimes) {
    const key = chime.button.dataset.key;
    if (key) {
      keyToChime.set(key, chime);
    }
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.target instanceof HTMLSelectElement) {
      return;
    }
    const chime = keyToChime.get(event.key.toLowerCase());
    if (chime) {
      ring(chime);
    }
  });

  const palette = root.querySelector<HTMLSelectElement>("#palette");
  if (palette) {
    const applyPalette = () => {
      setPaletteBrightness(palette.value === "bright" ? 1.4 : 0.7);
    };
    palette.addEventListener("change", applyPalette);
    applyPalette();
  }
}
