import { initChimes } from "./src/chimes";

const main = document.querySelector<HTMLElement>("main");
if (main) {
  initChimes(main);
}
