import { loadCase } from './fonts';
import { TypeCase } from './engine/typecase';
import { Setter, SHEET, MEASURE, MAX_LINES, MAX_CHARS, type LineInput, type PosterLayout, type SetLine } from './engine/setter';
import type { FaceId } from './engine/faces';
import { Printer, PRINT_W, PRINT_H } from './press/print';
import { posterShapes, drawShapes, type Shape } from './press/shapes';
import { Clock } from './clock';
import { STARTERS, PAPERS, INKS, type StarterPoster } from './posters';
import { runAttract } from './attract';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const ATTRACT = params.get('attract') === '1';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const page = $('page');
const press = $('press');
const stage = $('stage');
const sheetEl = $('sheet');
const bed = $('bed');
const proof = $<HTMLCanvasElement>('proof');
const printView = $<HTMLCanvasElement>('printView');
const formeCanvas = $<HTMLCanvasElement>('forme');
const linesEl = $<HTMLOListElement>('lines');
const statusEl = $('status');

export type Mode = 'set' | 'pulling' | 'pulled';

interface Shown { face: FaceId; text: string; wdth: number | null; top: number }

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export class App {
  readonly clock = new Clock(CAPTURE);
  tc!: TypeCase;
  setter!: Setter;
  printer!: Printer;
  lines: LineInput[] = [];
  seed = 1;
  faces: (FaceId | null)[] | undefined;
  paper = 0;
  ink = 0;
  mode: Mode = 'set';
  pullSeed = 1;
  layout: PosterLayout | null = null;
  private shown = new Map<number, Shown>();
  private shownLayout: PosterLayout | null = null;
  private dirty = true;
  private printFull = document.createElement('canvas');
  private printReady = false;
  private dpr = 1;
  private paperTile: HTMLCanvasElement | null = null;
  private pullT = -1;
  private pullDone: (() => void) | null = null;
  attractActive = false;

  async boot() {
    const fonts = await loadCase();
    this.tc = new TypeCase(fonts);
    this.setter = new Setter(this.tc);
    this.printer = new Printer(this.tc);
    this.buildChoices();
    const s = STARTERS[0];
    this.loadPoster(s);
    this.layoutSheet();
    addEventListener('resize', () => this.layoutSheet());
    visualViewport?.addEventListener('resize', () => this.layoutSheet());
    visualViewport?.addEventListener('scroll', () => this.syncViewport());
    this.bindActions();
    this.clock.add(this.frame);
    page.classList.add('ready');
    document.documentElement.dataset.ready = '1';
    if (ATTRACT) runAttract(this);
    else setTimeout(() => this.printer.warm(), 900);
  }

  // ---------- state ----------

  loadPoster(s: StarterPoster) {
    this.lines = s.lines.map((text, i) => ({ text, ink2: s.red.includes(i) }));
    this.seed = s.seed;
    this.faces = undefined;
    this.renderLines();
    this.reset(true);
  }

  /** Re-set the poster. `snap` skips the easing (new poster, resize). */
  reset(snap = false, editing = -1) {
    this.layout = this.setter.set(this.lines, this.seed, this.faces, editing);
    this.faces = this.layout.faces;
    if (snap) this.shown.clear();
    this.printReady = false;
    this.dirty = true;
    this.clock.add(this.frame);
  }

  setLineText(i: number, text: string) {
    const count = () => this.lines.filter((l) => l.text.trim()).length;
    const before = count();
    this.lines[i] = { text, ink2: this.lines[i]?.ink2 ?? false };
    if (this.mode !== 'set') this.setMode('set');
    this.reset(false, count() !== before ? -2 : i);
  }

  /** Empty rows close up when you leave them, keeping one spare row at the end. */
  compactLines() {
    const kept = this.lines.filter((l) => l.text.trim());
    if (kept.length === this.lines.length - 1 && !this.lines[this.lines.length - 1].text.trim()) return;
    const map = this.lines.map((l, i) => (l.text.trim() ? i : -1)).filter((i) => i >= 0);
    this.faces = this.faces ? map.map((i) => this.faces![i] ?? null) : undefined;
    this.lines = kept;
    this.renderLines();
    this.reset();
  }

  toggleInk(i: number) {
    if (!this.lines[i]) return;
    this.lines[i].ink2 = !this.lines[i].ink2;
    if (this.mode !== 'set') this.setMode('set');
    this.reset();
    this.syncLineButtons();
  }

  shuffle(seed?: number) {
    this.seed = seed ?? ((this.seed * 2654435761 + 977) >>> 0) % 100000;
    this.faces = undefined;
    if (this.mode !== 'set') this.setMode('set');
    this.reset();
  }

  setPaper(i: number) {
    this.paper = i;
    sheetEl.style.background = PAPERS[i].hex;
    this.syncSwatches();
    this.syncLineButtons();
    if (this.mode !== 'set') this.setMode('set');
    this.printReady = false;
    this.dirty = true;
    this.clock.add(this.frame);
  }

  setInk(i: number) {
    this.ink = i;
    this.syncSwatches();
    this.syncLineButtons();
    if (this.mode !== 'set') this.setMode('set');
    this.printReady = false;
    this.dirty = true;
    this.clock.add(this.frame);
  }

  setMode(m: Mode) {
    this.mode = m;
    press.dataset.mode = m;
    $('setActions').hidden = m === 'pulled';
    $('afterActions').hidden = m !== 'pulled';
    ($('pull') as HTMLButtonElement).disabled = m === 'pulling';
    ($('pull') as HTMLButtonElement).textContent = m === 'pulling' ? 'Pulling' : 'Pull the print';
    if (m === 'set') {
      this.pullT = -1;
      this.resetSheetStyles();
    }
    statusEl.textContent = '';
  }

  // ---------- sizing ----------

  layoutSheet() {
    const vw = document.documentElement.clientWidth;
    const vv = visualViewport;
    const vh = vv ? vv.height : innerHeight;
    const editing = page.classList.contains('editing');
    const gut = vw >= 768 ? 32 : 16;
    let h: number;
    if (editing) {
      h = Math.max(160, Math.min(vh * 0.52, vh - 190));
    } else if (ATTRACT) {
      h = vw >= 900 ? Math.min(innerHeight - 64, 900) : Math.min(innerHeight - 150, ((vw - 2 * gut) * 22) / 14);
    } else if (vw >= 900) {
      h = Math.min(innerHeight - 96, 920);
    } else if (innerWidth > innerHeight && innerHeight < 500) {
      h = innerHeight - 16;
    } else {
      h = Math.min(innerHeight - 150, ((vw - 2 * gut) * 22) / 14);
    }
    h = Math.max(160, Math.round(h));
    let w = Math.round((h * 14) / 22);
    if (w > vw - 2 * gut) { w = vw - 2 * gut; h = Math.round((w * 22) / 14); }
    stage.style.setProperty('--sheet-w', w + 'px');
    stage.style.setProperty('--sheet-h', h + 'px');
    this.dpr = Math.min(2, devicePixelRatio || 1);
    const pw = Math.round(w * this.dpr), ph = Math.round(h * this.dpr);
    for (const c of [proof, printView]) if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    if (formeCanvas.width !== pw || formeCanvas.height !== ph) { formeCanvas.width = pw; formeCanvas.height = ph; }
    this.syncViewport();
    this.dirty = true;
    this.drawPrintView();
    this.clock.add(this.frame);
  }

  syncViewport() {
    const vv = visualViewport;
    if (!vv) return;
    page.style.setProperty('--vv-top', vv.offsetTop + 'px');
    page.style.setProperty('--vv-h', vv.height + 'px');
  }

  // ---------- drawing ----------

  /** Easing between settings: widths and positions glide, every frame still fills the measure. */
  private frame = (dt: number) => {
    let moving = false;
    if (this.layout && this.dirty) {
      const k = this.attractActive && CAPTURE ? 1 - Math.exp(-dt / 45) : 1 - Math.exp(-dt / 55);
      const next = new Map<number, Shown>();
      for (const l of this.layout.lines) {
        const prev = this.shown.get(l.index);
        let s: Shown;
        if (!prev || prev.face !== l.face || reduced.matches) s = { face: l.face, text: l.text, wdth: l.wdth, top: l.ink.top };
        else {
          const wd = prev.wdth != null && l.wdth != null ? prev.wdth + (l.wdth - prev.wdth) * k : l.wdth;
          const top = prev.top + (l.ink.top - prev.top) * k;
          s = { face: l.face, text: l.text, wdth: wd, top };
          if ((wd != null && l.wdth != null && Math.abs(wd - l.wdth) > 0.05) || Math.abs(top - l.ink.top) > 0.004) moving = true;
          else s = { face: l.face, text: l.text, wdth: l.wdth, top: l.ink.top };
        }
        next.set(l.index, s);
      }
      this.shown = next;
      this.shownLayout = moving ? this.interpolated() : this.layout;
      this.drawProof();
      if (!moving) this.dirty = false;
    }
    if (this.pullT >= 0) { this.stepPull(dt); moving = true; }
    return moving || this.dirty || this.pullT >= 0;
  };

  /** The layout as currently shown during easing. */
  private interpolated(): PosterLayout {
    const L = this.layout!;
    const lines: SetLine[] = L.lines.map((l) => {
      const s = this.shown.get(l.index)!;
      if (l.mode !== 'fill' || l.wdth == null || s.wdth == null) {
        const dy = s.top - l.ink.top;
        return { ...l, baseline: l.baseline + dy, capTop: l.capTop + dy, ink: { ...l.ink, top: l.ink.top + dy, bottom: l.ink.bottom + dy } };
      }
      const wd = Math.round(s.wdth * 2) / 2;
      const m = this.tc.measure(l.face, wd, l.text);
      const size = MEASURE / (m.inkR - m.inkL);
      const x = SHEET.mx - m.inkL * size;
      const baseline = s.top + m.top * size;
      return {
        ...l, wdth: wd, size, x, baseline, capTop: baseline - m.cap * size,
        ink: { left: SHEET.mx, right: SHEET.mx + MEASURE, top: s.top, bottom: baseline - m.bottom * size },
        glyphs: m.glyphs.map((g) => ({ id: g.id, x: x + g.x * size })),
      };
    });
    return { ...L, lines };
  }

  get colors() {
    const ink = INKS[this.ink];
    return { paper: PAPERS[this.paper].hex, ink1: ink.main, ink2: ink.second };
  }

  private tile(): HTMLCanvasElement {
    if (this.paperTile) return this.paperTile;
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const x = c.getContext('2d')!;
    const img = x.createImageData(192, 192);
    let a = 12345;
    for (let i = 0; i < img.data.length; i += 4) {
      a = (a * 1103515245 + 12345) >>> 0;
      const v = 200 + ((a >>> 16) % 56);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.paperTile = c;
    return c;
  }

  drawProof() {
    const L = this.shownLayout || this.layout;
    const ctx = proof.getContext('2d')!;
    const { paper, ink1, ink2 } = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, proof.width, proof.height);
    if (L) {
      const ppi = proof.width / SHEET.w;
      drawShapes(ctx, this.tc, posterShapes(this.tc, L), { ppi, color1: ink1, color2: ink2 }, SHEET.w);
    }
    // A faint tooth so the proof reads as paper, not a screen.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = ctx.createPattern(this.tile(), 'repeat')!;
    ctx.fillRect(0, 0, proof.width, proof.height);
    ctx.restore();
  }

  private ensurePrint() {
    if (this.printReady || !this.layout) return;
    const t0 = performance.now();
    const how = this.printer.render(this.layout, { ...this.colors, seed: this.pullSeed }, this.printFull);
    document.documentElement.dataset.printMs = String(Math.round(performance.now() - t0));
    document.documentElement.dataset.printer = how;
    this.printReady = true;
    this.drawPrintView();
  }

  private drawPrintView() {
    if (!this.printReady) return;
    const ctx = printView.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Step down in halves so the fine salt averages instead of aliasing.
    let src: HTMLCanvasElement = this.printFull;
    let w = src.width, h = src.height;
    while (w / 2 > printView.width * 1.4) {
      const c = document.createElement('canvas');
      w = Math.round(w / 2); h = Math.round(h / 2);
      c.width = w; c.height = h;
      const cx = c.getContext('2d')!;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, w, h);
      src = c;
    }
    ctx.drawImage(src, 0, 0, printView.width, printView.height);
  }

  // ---------- the pull ----------

  /** Show a finished print at once, without the pull (attract mode's first frame). */
  printNow(seed: number) {
    if (!this.layout) return;
    this.pullSeed = seed;
    this.printReady = false;
    this.ensurePrint();
    this.resetSheetStyles();
    this.setMode('pulled');
  }

  /** Attract mode: the print slides away to show a fresh sheet. */
  wipePrint(a: number) {
    printView.style.clipPath = `inset(${Math.min(100, a * 100)}% 0 0 0)`;
  }

  pull(seed?: number): Promise<void> {
    if (!this.layout || !this.layout.lines.length || this.mode === 'pulling') return Promise.resolve();
    this.pullSeed = seed ?? ((Math.random() * 1e9) >>> 0);
    this.printReady = false;
    this.setMode('pulling');
    page.classList.remove('editing');
    return new Promise((done) => {
      const start = () => {
        this.ensurePrint();
        this.pullT = 0;
        this.pullDone = done;
        this.clock.add(this.frame);
      };
      if (CAPTURE) start(); else requestAnimationFrame(() => setTimeout(start, 0));
    });
  }

  private resetSheetStyles() {
    sheetEl.style.transform = '';
    sheetEl.style.boxShadow = '';
    sheetEl.style.opacity = '';
    sheetEl.style.filter = '';
    proof.style.visibility = '';
    printView.style.clipPath = '';
    printView.style.opacity = '';
    printView.style.visibility = '';
    bed.style.visibility = '';
  }

  static PULL_MS = 2300;

  private stepPull(dt: number) {
    this.pullT += dt;
    const t = this.pullT;
    if (reduced.matches) {
      const a = seg(t, 0, 450);
      proof.style.visibility = 'visible';
      printView.style.visibility = 'visible';
      printView.style.opacity = String(a);
      if (t >= 450) this.finishPull();
      return;
    }
    const H = stage.clientHeight;
    bed.style.visibility = 'visible';
    // A: the proof sheet lifts off the bed.
    if (t < 380) {
      const a = easeIn(seg(t, 0, 380));
      sheetEl.style.transform = `translateY(${-a * 1.18 * H}px) rotate(${-a * 2}deg)`;
      proof.style.visibility = 'visible';
      printView.style.visibility = 'hidden';
      this.drawForme(-1);
      return;
    }
    // B: the roller inks the forme.
    if (t < 1000) {
      sheetEl.style.transform = `translateY(${-1.3 * H}px)`;
      this.drawForme(ease(seg(t, 380, 1000)));
      return;
    }
    // C: a fresh sheet comes down.
    proof.style.visibility = 'hidden';
    if (t < 1360) {
      const a = easeOut(seg(t, 1000, 1360));
      const lift = 1 - a;
      sheetEl.style.transform = `translateY(${-lift * 0.5 * H}px) scale(${1 + lift * 0.06})`;
      sheetEl.style.boxShadow = `${7 + lift * 30}px ${9 + lift * 40}px 0 rgba(10,20,50,${0.25 + lift * 0.1})`;
      sheetEl.style.opacity = String(Math.min(1, a * 3));
      printView.style.visibility = 'hidden';
      this.drawForme(1.2);
      return;
    }
    // D: pressure.
    if (t < 1640) {
      const a = Math.sin(Math.PI * seg(t, 1360, 1640));
      sheetEl.style.transform = `scale(${1 - 0.012 * a})`;
      sheetEl.style.opacity = '1';
      sheetEl.style.boxShadow = `${7 - 5 * a}px ${9 - 6 * a}px 0 rgba(10,20,50,0.25)`;
      sheetEl.style.filter = `brightness(${1 - 0.1 * a})`;
      return;
    }
    // E: the sheet lifts and the print shows, top edge first.
    sheetEl.style.filter = '';
    const a = easeOut(seg(t, 1640, Number(App.PULL_MS)));
    const lift = Math.sin(Math.PI * seg(t, 1640, Number(App.PULL_MS)));
    sheetEl.style.transform = `translateY(${-lift * 0.012 * H}px) scale(${1 + lift * 0.014})`;
    sheetEl.style.boxShadow = `${7 + lift * 6}px ${9 + lift * 8}px 0 var(--blue-shadow)`;
    printView.style.visibility = 'visible';
    printView.style.clipPath = `inset(0 0 ${(1 - a) * 100}% 0)`;
    if (t >= App.PULL_MS) this.finishPull();
  }

  private finishPull() {
    this.pullT = -1;
    this.resetSheetStyles();
    this.setMode('pulled');
    const d = this.pullDone;
    this.pullDone = null;
    d?.();
  }

  /** The forme seen from above: type reversed, dry wood until the roller has passed. */
  private drawForme(inked: number) {
    if (!this.layout) return;
    const ctx = formeCanvas.getContext('2d')!;
    const W = formeCanvas.width, Hh = formeCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#24201d';
    ctx.fillRect(0, 0, W, Hh);
    const ppi = W / SHEET.w;
    const shapes = posterShapes(this.tc, this.layout);
    const { ink1, ink2 } = this.colors;
    const rollerY = inked * SHEET.h * 1.1 - 0.05 * SHEET.h;
    const wet = (s: Shape) => {
      const y = s.kind === 'rect' ? s.y : s.y - (s.kind === 'glyph' ? s.cap / 2 : 0);
      return y < rollerY;
    };
    // Type-high wood: a lighter face over a darker shoulder.
    drawShapes(ctx, this.tc, shapes, { ppi, color1: '#7a5634', color2: '#7a5634', mirror: true, jitter: () => [0.03, 0.04, 0, 1] }, SHEET.w);
    drawShapes(ctx, this.tc, shapes, { ppi, color1: ink1, color2: ink2, mirror: true, color: (s) => (wet(s) ? (s.ink === 2 ? ink2 : ink1) : '#c39a66') }, SHEET.w);
    if (inked >= 0 && inked <= 1) {
      const ry = rollerY * ppi;
      const rh = 0.9 * ppi;
      ctx.fillStyle = '#0d0b0a';
      ctx.fillRect(-10, ry - rh / 2, W + 20, rh);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-10, ry - rh * 0.28, W + 20, rh * 0.12);
    }
  }

  // ---------- saving ----------

  async save() {
    this.ensurePrint();
    const blob: Blob | null = await new Promise((r) => this.printFull.toBlob(r, 'image/png'));
    if (!blob) { statusEl.textContent = 'The print could not be saved in this browser.'; return; }
    const name = 'tall-order-poster.png';
    const file = new File([blob], name, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'Tall Order poster' });
        statusEl.textContent = 'Shared.';
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    statusEl.textContent = `Saved ${name}, ${PRINT_W} by ${PRINT_H} pixels.`;
  }

  // ---------- the desk ----------

  renderLines() {
    const spare = this.attractActive ? 0 : 1;
    const rows = Math.min(MAX_LINES, Math.max(1, this.lines.filter((l) => l.text.trim()).length + spare, this.lines.length));
    while (this.lines.length < rows) this.lines.push({ text: '', ink2: false });
    linesEl.textContent = '';
    for (let i = 0; i < rows; i++) {
      const li = document.createElement('li');
      li.className = 'line';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = this.lines[i].text;
      input.maxLength = MAX_CHARS;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('enterkeyhint', i < MAX_LINES - 1 ? 'next' : 'done');
      input.setAttribute('aria-label', `Line ${i + 1}`);
      input.placeholder = !this.attractActive && i === rows - 1 && !this.lines[i].text ? 'Add a line' : '';
      input.dataset.i = String(i);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ink-toggle';
      btn.dataset.i = String(i);
      btn.appendChild(document.createElement('span'));
      li.append(input, btn);
      linesEl.appendChild(li);
    }
    this.syncLineButtons();
  }

  syncLineButtons() {
    const ink = INKS[this.ink];
    linesEl.querySelectorAll<HTMLButtonElement>('.ink-toggle').forEach((b) => {
      const i = Number(b.dataset.i);
      const on = !!this.lines[i]?.ink2;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `Line ${i + 1} in the second ink`);
      b.style.setProperty('--dot', on ? ink.second : ink.main);
    });
    linesEl.style.setProperty('--stock', PAPERS[this.paper].hex);
  }

  private ensureSpareRow() {
    const filled = this.lines.filter((l) => l.text.trim()).length;
    const inputs = linesEl.querySelectorAll('input');
    const last = inputs[inputs.length - 1] as HTMLInputElement | undefined;
    if (last && last.value.trim() && inputs.length < MAX_LINES && filled < MAX_LINES) {
      const focusI = Number((document.activeElement as HTMLElement)?.dataset?.i ?? -1);
      const pos = (document.activeElement as HTMLInputElement)?.selectionStart ?? null;
      this.renderLines();
      if (focusI >= 0) {
        const el = linesEl.querySelector<HTMLInputElement>(`input[data-i="${focusI}"]`);
        el?.focus({ preventScroll: true });
        if (el && pos != null) el.setSelectionRange(pos, pos);
      }
    }
  }

  buildChoices() {
    const stocks = $('stocks'), inks = $('inks');
    PAPERS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.paper = String(i);
      b.setAttribute('aria-label', `${p.name} paper`);
      const dot = document.createElement('i');
      dot.style.setProperty('--c', p.hex);
      b.appendChild(dot);
      b.addEventListener('click', () => { this.endAttract(); this.setPaper(i); });
      stocks.appendChild(b);
    });
    INKS.forEach((k, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.ink = String(i);
      b.setAttribute('aria-label', `${k.name} ink`);
      const dot = document.createElement('i');
      dot.style.setProperty('--c', k.main);
      const half = document.createElement('b');
      half.style.setProperty('--c2', k.second);
      dot.appendChild(half);
      b.appendChild(dot);
      b.addEventListener('click', () => { this.endAttract(); this.setInk(i); });
      inks.appendChild(b);
    });
    this.syncSwatches();
  }

  syncSwatches() {
    document.querySelectorAll<HTMLButtonElement>('[data-paper]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.paper) === this.paper)));
    document.querySelectorAll<HTMLButtonElement>('[data-ink]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.ink) === this.ink)));
  }

  private bindActions() {
    linesEl.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.tagName !== 'INPUT') return;
      this.endAttract();
      this.setLineText(Number(t.dataset.i), t.value);
      this.ensureSpareRow();
    });
    linesEl.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.tagName !== 'INPUT' || e.key !== 'Enter') return;
      e.preventDefault();
      const next = linesEl.querySelector<HTMLInputElement>(`input[data-i="${Number(t.dataset.i) + 1}"]`);
      if (next) next.focus(); else t.blur();
    });
    linesEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.ink-toggle') as HTMLElement | null;
      if (b) { this.endAttract(); this.toggleInk(Number(b.dataset.i)); }
    });
    const narrowTouch = () => matchMedia('(pointer: coarse)').matches && innerWidth < 900;
    linesEl.addEventListener('focusin', (e) => {
      if (!narrowTouch()) return;
      page.classList.add('editing');
      this.layoutSheet();
      (e.target as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
    linesEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!linesEl.contains(document.activeElement)) this.compactLines();
        if (!linesEl.contains(document.activeElement) && page.classList.contains('editing')) {
          page.classList.remove('editing');
          this.layoutSheet();
        }
      }, 120);
    });
    $('done').addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur();
      page.classList.remove('editing');
      this.layoutSheet();
    });
    // Tap a line on the sheet: second ink.
    let down: { x: number; y: number } | null = null;
    stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || this.mode === 'pulling') { down = null; return; }
      down = null;
      this.endAttract();
      const r = stage.getBoundingClientRect();
      const y = ((e.clientY - r.top) / r.height) * SHEET.h;
      const hit = this.lineAt(y);
      if (hit != null) this.toggleInk(hit);
    });
    $('shuffle').addEventListener('click', () => { this.endAttract(); this.shuffle(); });
    $('pull').addEventListener('click', () => { this.endAttract(); void this.pull(); });
    $('again').addEventListener('click', () => { this.endAttract(); this.setMode('set'); void this.pull(); });
    $('change').addEventListener('click', () => {
      this.endAttract();
      this.setMode('set');
      this.dirty = true;
      this.clock.add(this.frame);
      const first = linesEl.querySelector<HTMLInputElement>('input');
      if (!matchMedia('(pointer: coarse)').matches) first?.focus();
      else linesEl.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
    });
    $('save').addEventListener('click', () => { this.endAttract(); void this.save(); });
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      addEventListener(ev, () => this.endAttract(), { passive: true, capture: true });
    }
  }

  lineAt(y: number): number | null {
    const L = this.layout;
    if (!L || !L.lines.length) return null;
    let best: number | null = null, bestD = Infinity;
    for (const l of L.lines) {
      const d = y < l.ink.top ? l.ink.top - y : y > l.ink.bottom ? y - l.ink.bottom : 0;
      if (d < bestD) { bestD = d; best = l.index; }
    }
    return bestD < 0.6 ? best : null;
  }

  endAttract() {
    if (!this.attractActive || CAPTURE) return;
    this.attractActive = false;
    page.classList.remove('attract');
    this.lines = this.lines.map((l, i) => ({ text: (linesEl.querySelector<HTMLInputElement>(`input[data-i="${i}"]`)?.value ?? l.text), ink2: l.ink2 }));
    this.renderLines();
    this.reset();
    document.documentElement.dataset.attract = 'ended';
    this.layoutSheet();
  }

  /** Used by attract mode: show the typed text in the line inputs too. */
  showTyped(texts: string[], active = -1) {
    const inputs = linesEl.querySelectorAll<HTMLInputElement>('input');
    inputs.forEach((inp, i) => {
      inp.value = texts[i] ?? '';
      const li = inp.parentElement as HTMLElement;
      if (i === active) li.dataset.active = '1'; else delete li.dataset.active;
    });
  }
}

const app = new App();
(window as unknown as { __tallOrder: App }).__tallOrder = app;
if (ATTRACT) {
  page.classList.add('attract');
  app.attractActive = true;
}
app.boot().catch((e) => {
  console.error(e);
  $('loading').textContent = 'The type case could not be loaded.';
});
