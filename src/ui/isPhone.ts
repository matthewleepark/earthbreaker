/** Matches the phone breakpoint in styles.css. Side panels start collapsed there so the globe stays visible. */
export function isPhone() {
  return window.matchMedia("(max-width: 760px)").matches;
}
