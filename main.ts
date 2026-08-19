import { initChimes } from "./src/chimes";

const field = document.querySelector<HTMLElement>(".chime-field");
if (field) {
  initChimes(field);
}
