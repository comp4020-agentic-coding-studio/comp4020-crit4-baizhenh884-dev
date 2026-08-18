import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Crit 4, "An instrument": https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/04-instrument/
//
// Two spec lines are mechanically checkable; the rest (expressive, two
// players sound different, a stranger can pick it up, no fail state) are
// judged live at the crit, not here.
const DIST = resolve("dist");

function pageDocs(): { name: string; doc: Document }[] {
  return readdirSync(DIST)
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({
      name,
      doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
    }));
}

function bundledScript(): string {
  const assetsDir = join(DIST, "assets");
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(join(assetsDir, name), "utf8"))
    .join("\n");
}

describe("crit 4: sound is made live, not played back", () => {
  it("ships no <audio> or <video> element", () => {
    for (const { name, doc } of pageDocs()) {
      expect(
        doc.querySelectorAll("audio, video"),
        `${name} has an <audio>/<video> element — sound must be synthesised live by the player, not played back from a recording.`,
      ).toHaveLength(0);
    }
  });

  it("uses the Web Audio API to synthesise sound", () => {
    expect(
      bundledScript(),
      "no reference to AudioContext in the built script — nothing suggests sound is synthesised client-side.",
    ).toMatch(/AudioContext/);
  });
});

describe("crit 4: playable with whatever is at hand", () => {
  it("has at least one real, focusable control in the instrument itself", () => {
    // Scoped to <main>, not the whole page: the boilerplate nav link in
    // <header> would otherwise satisfy this before any instrument exists.
    const controls = pageDocs().flatMap(({ doc }) =>
      Array.from(
        doc.querySelectorAll("main button, main [role='button'], main a[href], main input, main select, main textarea"),
      ),
    );
    expect(
      controls.length,
      "no button, link, or form control found inside <main> — a keyboard-only or touch-only player needs a real interactive element there, not a bare div/canvas click handler.",
    ).toBeGreaterThan(0);
  });
});
