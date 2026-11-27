// Attract mode: the poster types itself line by line, re-setting on every letter, the faces
// shuffle once, the print is pulled and held, then it starts again. The first frame is a print.
import type { App } from './main';
import { STARTERS } from './posters';

const CYCLE = 10000;
const T_CLEAR = 1000;
const T_TYPE = 1450;
const T_TYPED = 5450;
const T_SHUFFLE = 5850;
const T_PULL = 6500;

export function runAttract(app: App) {
  const params = new URLSearchParams(location.search);
  const loopOne = params.has('loop') || app.clock.capture;
  let idx = Number(params.get('poster') || 0) % STARTERS.length;
  let prev = STARTERS[idx];
  let cur = STARTERS[idx];
  let t = 0;
  let typed = -1;
  let shuffled = false;
  let pulled = false;
  let cycle = 0;

  const typingSeed = (s: number) => s + 100;
  const total = (lines: string[]) => lines.reduce((s, l) => s + l.length, 0);

  // First frame: the finished print of the poster.
  app.loadPoster(prev);
  app.printNow(9000 + idx);
  app.showTyped(prev.lines, prev.lines.length - 1);
  document.documentElement.dataset.attractLoop = '0';

  const tick = (dt: number) => {
    if (!app.attractActive) return false;
    t += dt;
    if (t >= CYCLE) {
      t -= CYCLE;
      cycle++;
      document.documentElement.dataset.attractLoop = String(cycle);
      document.documentElement.dataset.attractStart = String(performance.now());
      prev = cur;
      if (!loopOne) { idx = (idx + 1) % STARTERS.length; }
      cur = STARTERS[idx];
      typed = -1; shuffled = false; pulled = false;
    }
    if (t >= T_CLEAR && t < T_TYPE) {
      const a = (t - T_CLEAR) / (T_TYPE - T_CLEAR);
      app.wipePrint(a);
      if (typed === -1) {
        app.lines = cur.lines.map((_, i) => ({ text: '', ink2: cur.red.includes(i) }));
        app.seed = typingSeed(cur.seed);
        app.faces = undefined;
        app.renderLines();
        app.showTyped([], 0);
        app.reset(true);
        typed = 0;
      }
    } else if (t >= T_TYPE && t < T_SHUFFLE) {
      if (app.mode !== 'set') app.setMode('set');
      const n = total(cur.lines);
      const want = Math.min(n, Math.floor(((t - T_TYPE) / (T_TYPED - T_TYPE)) * n) + 1);
      if (want !== typed) {
        typed = want;
        let left = want;
        let active = 0;
        const texts = cur.lines.map((l, i) => {
          const k = Math.max(0, Math.min(l.length, left));
          if (left > 0) active = i;
          left -= k;
          return l.slice(0, k);
        });
        texts.forEach((tx, i) => { app.lines[i] = { text: tx, ink2: cur.red.includes(i) }; });
        app.showTyped(texts, active);
        app.reset();
      }
    } else if (t >= T_SHUFFLE && t < T_PULL && !shuffled) {
      shuffled = true;
      app.shuffle(cur.seed);
    } else if (t >= T_PULL && !pulled) {
      pulled = true;
      void app.pull(9000 + idx);
    }
    return true;
  };
  void prev;
  app.clock.add(tick);
}
