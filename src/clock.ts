// One clock drives everything that moves. Normally it follows requestAnimationFrame and sleeps
// when nothing is moving or the tab is hidden; with ?capture=1 it only moves when window.__step(ms)
// is called, so recordings are stepped frame by frame.
type Tick = (dt: number, now: number) => boolean | void;

export class Clock {
  now = 0;
  readonly capture: boolean;
  private ticks = new Set<Tick>();
  private raf = 0;
  private last = 0;

  constructor(capture: boolean) {
    this.capture = capture;
    if (capture) {
      (window as unknown as { __step: (ms: number) => void }).__step = (ms: number) => this.advance(ms);
    } else {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop(); else this.wake();
      });
    }
  }

  /** Run `fn` every frame until it returns false. */
  add(fn: Tick) {
    this.ticks.add(fn);
    this.wake();
  }

  remove(fn: Tick) {
    this.ticks.delete(fn);
  }

  wake() {
    if (this.capture || this.raf || document.hidden || !this.ticks.size) return;
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.max(0, Math.min(64, t - this.last));
      this.last = t;
      this.raf = 0;
      this.advance(dt);
      if (this.ticks.size && !document.hidden) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  advance(dt: number) {
    this.now += dt;
    for (const fn of [...this.ticks]) {
      if (fn(dt, this.now) === false) this.ticks.delete(fn);
    }
  }
}
