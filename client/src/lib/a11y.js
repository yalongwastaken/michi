// a11y.js — small accessibility helpers.

/**
 * After an action removes the focused element (deleting a card/row), focus would fall
 * to <body> and a keyboard/SR user loses their place. Move it to the current view's
 * heading instead — a recognized "return to context" pattern.
 */
export function focusMainHeading() {
  const h = document.querySelector("main h2");
  if (h) {
    h.setAttribute("tabindex", "-1");
    h.focus({ preventScroll: true });
  }
}
