// Single source of "now". Tests can substitute a fake clock; the app uses Date.now().
let provider = () => Date.now();

export const clock = {
  now: () => provider(),
  set(fn) { provider = fn; },
  reset() { provider = () => Date.now(); },
};
