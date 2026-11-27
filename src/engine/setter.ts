// The compositor. Every line is set to reach both edges of the measure by choosing a face, a
// width on its width axis and a size, and the stack is made to fill the sheet top to bottom by
// trading height through width: a condensed setting is taller, an extended one shorter.
import { FACES, FACE_IDS, type FaceId } from './faces';
import { TypeCase, type LineMetrics } from './typecase';
import { mulberry32, hashString } from './rng';

/** Window card, 14 by 22 inches. All layout values are in inches. */
export const SHEET = { w: 14, h: 22, mx: 0.8, mt: 0.9, mb: 0.9 };
export const MEASURE = SHEET.w - 2 * SHEET.mx;
export const COLUMN = SHEET.h - SHEET.mt - SHEET.mb;

export const MAX_LINES = 8;
export const MAX_CHARS = 34;

export type Role = 'head' | 'body' | 'catch';
export type Mode = 'fill' | 'flank';

export interface LineInput { text: string; ink2?: boolean }

export interface SetLine {
  /** Index of the input line this came from. */
  index: number;
  text: string;
  face: FaceId;
  wdth: number | null;
  /** Inches per em. */
  size: number;
  /** Origin of the first glyph and the baseline, in inches from the sheet's top left. */
  x: number;
  baseline: number;
  ink: { left: number; right: number; top: number; bottom: number };
  capTop: number;
  mode: Mode;
  role: Role;
  ink2: boolean;
  glyphs: { id: number; x: number }[];
  flanks: { l: [number, number]; r: [number, number] } | null;
}

export interface Ornament { kind: 'rule' | 'stars'; x0: number; x1: number; y: number; h: number }

export interface PosterLayout {
  lines: SetLine[];
  ornaments: Ornament[];
  faces: (FaceId | null)[];
  status: 'filled' | 'underfull';
  /** Space between the stack and the column, in inches (0 when the stack fills the sheet). */
  slack: number;
}

const CATCH_WORDS = new Set([
  'AND', 'WITH', 'AT', 'AT THE', 'THE', '&', '+', 'PLUS', 'ALSO', 'FEATURING', 'PRESENTS', 'PRESENT',
  'FOR', 'OF', 'OF THE', 'IN', 'IN THE', 'ON', 'ON THE', 'BY', 'FROM', 'TO', 'VS', 'VS.', 'OR', 'A', 'AN',
  'AND THE', 'WITH THE', '& THE', 'STARRING', 'PLUS THE', 'FEAT.', 'AND HIS', 'AND HER', 'AND THEIR', 'WITH HIS',
  'WITH HER', 'AT THE OLD', 'FT.', 'IS', 'UNTIL', 'TILL', 'NEXT', 'THIS', 'ONE NIGHT ONLY', 'ALL NIGHT', 'FREE',
]);

/** Upper case as wood type is cut, one space between words, no control characters. */
export function normalize(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .toLocaleUpperCase('en')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS * 2);
}

export function isCatch(text: string): boolean {
  return CATCH_WORDS.has(text) || /^[^\p{L}\p{N}]{1,2}$/u.test(text);
}

/** How one face sets one line, sampled across its width axis. */
interface FaceFit {
  face: FaceId;
  text: string;
  /** Width stops and the stacked height (inches) of the line filled to the measure at each. */
  w: number[];
  h: number[];
  /** Height of the filled line at the default width, used for flank settings. */
  hMid: number;
  wMid: number | null;
}

const STOPS = 9;

interface Item {
  line: number; // index into the active lines
  role: Role;
  fit: FaceFit;
  t: number; // target height
  lo: number; // smallest filled height (widest setting)
  hi: number; // largest filled height (narrowest setting, or the role cap)
  mode: Mode;
  /** For flanked lines: the range of heights the solver may use. */
  flo: number;
  fhi: number;
}

function capFor(role: Role, n: number): number {
  if (role === 'catch') return 0.05 * COLUMN;
  return (n <= 1 ? 0.92 : n === 2 ? 0.56 : n <= 4 ? 0.42 : n <= 6 ? 0.34 : 0.28) * COLUMN;
}

function gapBetween(a: number, b: number): number {
  return Math.min(0.46, Math.max(0.22, 0.12 * Math.min(a, b)));
}

export class Setter {
  readonly tc: TypeCase;
  private fits = new Map<string, FaceFit>();

  constructor(tc: TypeCase) {
    this.tc = tc;
  }

  /** The text a face can actually set: characters it has no type for are left out. */
  filterFor(face: FaceId, text: string): string {
    let out = '';
    for (const ch of text) out += ch === ' ' || this.tc.supports(face, ch) ? ch : '';
    return out.replace(/\s+/g, ' ').trim();
  }

  fit(face: FaceId, rawText: string): FaceFit {
    const key = face + '|' + rawText;
    let f = this.fits.get(key);
    if (f) return f;
    const text = this.filterFor(face, rawText);
    const def = FACES[face];
    const w: number[] = [];
    const h: number[] = [];
    const heightAt = (wd: number | null) => {
      const m = this.tc.measure(face, wd, text);
      const e = Math.max(1e-4, m.inkR - m.inkL);
      return (MEASURE * (m.top - m.bottom)) / e;
    };
    if (def.wdth) {
      for (let k = 0; k < STOPS; k++) {
        const wd = def.wdth[0] + ((def.wdth[1] - def.wdth[0]) * k) / (STOPS - 1);
        w.push(wd);
        h.push(heightAt(wd));
      }
    } else {
      w.push(0);
      h.push(heightAt(null));
    }
    const wMid = def.wdth ? Math.min(def.wdth[1], Math.max(def.wdth[0], 100)) : null;
    f = { face, text, w, h, hMid: heightAt(wMid), wMid };
    this.fits.set(key, f);
    if (this.fits.size > 4000) this.fits.clear();
    return f;
  }

  /** Width that makes the filled line this tall (heights fall as width grows). */
  static widthFor(fit: FaceFit, target: number): number {
    const { w, h } = fit;
    if (w.length === 1) return w[0];
    if (target >= h[0]) return w[0];
    if (target <= h[h.length - 1]) return w[w.length - 1];
    for (let k = 0; k < w.length - 1; k++) {
      const a = h[k], b = h[k + 1];
      if ((target <= a && target >= b) || (target >= a && target <= b)) {
        const t = a === b ? 0 : (a - target) / (a - b);
        return w[k] + (w[k + 1] - w[k]) * t;
      }
    }
    return w[w.length - 1];
  }

  /** Can this face set this line at all, in this role? */
  valid(face: FaceId, text: string, role: Role, n: number): boolean {
    const def = FACES[face];
    const t = this.filterFor(face, text);
    if (t.length === 0) return false;
    if (t.length < text.replace(/[^\p{L}\p{N}&]/gu, '').length * 0.5) return false;
    if (role === 'catch') return def.catchLine || face === 'gothic' || face === 'clarendon';
    if (role === 'head' && !def.headliner) return false;
    const len = t.length;
    if (len < def.minChars || len > def.maxChars) return false;
    if (!def.wdth) {
      const f = this.fit(face, text);
      const cap = capFor(role, n);
      if (f.h[0] > cap * 1.02 || f.h[0] < 0.028 * COLUMN) return false;
    }
    return true;
  }

  /** Roles: one or two lines dominate, connector words become catch lines. */
  roles(texts: string[]): Role[] {
    const n = texts.length;
    const roles: Role[] = texts.map((t) => (n > 1 && isCatch(t) ? 'catch' : 'body'));
    const prom = texts.map((t, i) => (roles[i] === 'catch' ? -1 : this.fit('gothic', t).hMid));
    let best = -1;
    prom.forEach((p, i) => { if (p > 0 && (best < 0 || p > prom[best] * 1.0001)) best = i; });
    if (best >= 0) {
      roles[best] = 'head';
      if (n >= 4) {
        let second = -1;
        prom.forEach((p, i) => { if (i !== best && p > 0 && (second < 0 || p > prom[second])) second = i; });
        if (second >= 0 && prom[second] >= prom[best] * 0.82) roles[second] = 'head';
      }
    }
    return roles;
  }

  private items(texts: string[], faces: FaceId[], roles: Role[]): Item[] {
    const n = texts.length;
    return texts.map((t, i) => {
      const fit = this.fit(faces[i], t);
      const role = roles[i];
      const cap = capFor(role, n);
      const hiFill = fit.h[0];
      const loFill = fit.h[fit.h.length - 1];
      // Target: shorter lines are naturally bigger; compress the range and lift the headliners.
      const natural = fit.hMid;
      let tt = Math.pow(natural, 0.62) * (role === 'head' ? 1.45 : 1);
      if (role === 'catch') tt = 0.032 * COLUMN;
      const item: Item = {
        line: i, role, fit, t: tt, lo: loFill, hi: Math.min(hiFill, cap), mode: 'fill',
        flo: 0.024 * COLUMN, fhi: Math.min(cap, 0.7 * fit.hMid),
      };
      if (role === 'catch') {
        item.mode = 'flank';
        const hc = Math.min(0.034 * COLUMN, 0.62 * fit.hMid);
        item.flo = hc; item.fhi = hc;
      } else if (loFill > item.hi) {
        // Too short to fill without towering over the sheet: set it at the cap with flanking rules.
        item.mode = 'flank';
        item.flo = Math.min(item.hi, 0.7 * fit.hMid); item.fhi = item.flo;
      }
      return item;
    });
  }

  private heights(items: Item[], k: number): number[] {
    return items.map((it) => {
      if (it.mode === 'flank') return Math.min(it.fhi, Math.max(it.flo, k * it.t * 0.6));
      return Math.min(it.hi, Math.max(it.lo, k * it.t));
    });
  }

  private total(hs: number[]): number {
    let s = 0;
    for (let i = 0; i < hs.length; i++) {
      s += hs[i];
      if (i > 0) s += gapBetween(hs[i - 1], hs[i]);
    }
    return s;
  }

  /**
   * Find the scale k that makes the stack exactly fill the column. Role caps keep the hierarchy;
   * when the copy is too long to fill the sheet under them, they are relaxed step by step, so the
   * sheet fills with type before any extra space opens between lines.
   */
  private solve(items: Item[]): { hs: number[]; status: 'filled' | 'underfull' } {
    const base = items.map((it) => it.hi);
    const full = items.map((it) => it.fit.h[0]);
    let r = this.solveAt(items);
    for (const level of [1, 2]) {
      if (r.status === 'filled') break;
      items.forEach((it, i) => {
        if (it.mode !== 'fill') return;
        const grow = it.role === 'head' ? (level === 1 ? 1.5 : 9) : level === 1 ? 1.35 : 9;
        it.hi = Math.min(full[i], base[i] * grow);
      });
      r = this.solveAt(items);
    }
    return r;
  }

  private solveAt(items: Item[]): { hs: number[]; status: 'filled' | 'underfull' } {
    // Overfull even at the widest settings: flank the least prominent lines until it fits.
    for (let guard = 0; guard < items.length; guard++) {
      if (this.total(this.heights(items, 0)) <= COLUMN) break;
      const cands = items.filter((it) => it.mode === 'fill').sort((a, b) => a.t - b.t);
      if (!cands.length) break;
      const it = cands[0];
      it.mode = 'flank';
      it.fhi = Math.min(it.fhi, 0.9 * it.lo);
      it.flo = Math.min(it.flo, it.fhi);
    }
    if (this.total(this.heights(items, 0)) > COLUMN) {
      // Still too tall: everything is at its smallest; shrink the flanked lines proportionally.
      const hs = this.heights(items, 0);
      const fixed = items.reduce((s, it, i) => s + (it.mode === 'fill' ? hs[i] : 0), 0);
      const flank = items.reduce((s, it, i) => s + (it.mode === 'flank' ? hs[i] : 0), 0);
      const gaps = this.total(hs) - fixed - flank;
      const f = Math.max(0.2, (COLUMN - fixed - gaps) / Math.max(1e-6, flank));
      items.forEach((it, i) => { if (it.mode === 'flank') { it.flo = it.fhi = hs[i] * f; } });
    }
    let lo = 0, hi = 1;
    while (this.total(this.heights(items, hi)) < COLUMN && hi < 1e6) hi *= 2;
    if (this.total(this.heights(items, hi)) < COLUMN) return { hs: this.heights(items, hi), status: 'underfull' };
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (this.total(this.heights(items, mid)) < COLUMN) lo = mid; else hi = mid;
    }
    return { hs: this.heights(items, hi), status: 'filled' };
  }

  /** Score an assignment of faces: lower is better. */
  score(texts: string[], faces: FaceId[], roles: Role[], jitter: number): number {
    const items = this.items(texts, faces, roles);
    const { hs, status } = this.solve(items);
    let s = jitter;
    if (status === 'underfull') s += 32 * (COLUMN - this.total(hs)) / COLUMN;
    items.forEach((it, i) => {
      if (it.mode === 'flank' && it.role !== 'catch') s += 3.5;
      if (it.mode === 'fill' && FACES[it.fit.face].wdth) {
        const w = Setter.widthFor(it.fit, hs[i]);
        const [a, b] = FACES[it.fit.face].wdth!;
        const u = (w - a) / (b - a);
        if (u < 0.03 || u > 0.97) s += 0.6;
      }
    });
    const counts = new Map<FaceId, number>();
    faces.forEach((f, i) => {
      counts.set(f, (counts.get(f) || 0) + 1);
      if (i > 0 && faces[i - 1] === f) s += 2.4;
    });
    counts.forEach((c, f) => { if (c > 2) s += 1.3 * (c - 2); if (f === 'sixcaps' && c > 1) s += 1.6 * (c - 1); });
    s -= 0.5 * counts.size;
    // One or two lines should dominate: the biggest line well above the typical one.
    const body = hs.filter((_, i) => roles[i] !== 'catch').sort((a, b) => b - a);
    if (body.length >= 3) {
      const median = body[Math.floor(body.length / 2)];
      const ratio = body[0] / median;
      if (ratio < 1.3) s += 6 * (1.3 - ratio);
      // The line picked as headliner (the shortest copy) should be among the two biggest.
      const headIdx = roles.indexOf('head');
      if (headIdx >= 0 && hs[headIdx] < body[Math.min(1, body.length - 1)] * 0.98) s += 1.5;
    }
    return s;
  }

  private candidates(text: string, role: Role, n: number): FaceId[] {
    const c = FACE_IDS.filter((f) => this.valid(f, text, role, n));
    return c.length ? c : ['gothic'];
  }

  /**
   * Pick a face for every line. With a previous assignment, lines keep their face while it can
   * still set them, so typing never makes the type jump around.
   */
  assign(texts: string[], seed: number, prev?: (FaceId | null)[], editing = -1): FaceId[] {
    const n = texts.length;
    const roles = this.roles(texts);
    const cands = texts.map((t, i) => this.candidates(t, roles[i], n));
    const rand = mulberry32(seed ^ hashString(String(n)));
    if (prev && prev.length) {
      const out: (FaceId | null)[] = texts.map((_, i) => {
        const p = prev[i];
        return p && cands[i].includes(p) ? p : null;
      });
      const decoUsed = (skip = -1) => out.some((f, j) => j !== skip && f && FACES[f].decorative);
      // The line being typed may move to a face that clearly sets it better; the rest stay put.
      // When lines were added or removed (editing === -2), every line gets that chance.
      const movable = editing === -2 ? texts.map((_, j) => j) : editing >= 0 && editing < n ? [editing] : [];
      for (const ed of movable) {
        if (!out[ed]) continue;
        const filled = out.map((f, j) => f ?? cands[j][0]) as FaceId[];
        const current = this.score(texts, filled, roles, 0);
        let best = out[ed]!;
        let bestS = current - 0.8;
        for (const c of cands[ed]) {
          if (c === out[ed] || (FACES[c].decorative && decoUsed(ed))) continue;
          const trial = filled.slice();
          trial[ed] = c;
          const sc = this.score(texts, trial, roles, 0);
          if (sc < bestS) { bestS = sc; best = c; }
        }
        out[ed] = best;
      }
      for (let i = 0; i < n; i++) {
        if (out[i]) continue;
        let best: FaceId = cands[i][0];
        let bestS = Infinity;
        for (const c of cands[i]) {
          if (FACES[c].decorative && decoUsed()) continue;
          const trial = out.map((f, j) => (j === i ? c : f ?? cands[j][0])) as FaceId[];
          const sc = this.score(texts, trial, roles, 0) + (hashString(c + seed + ':' + i) % 100) / 400;
          if (sc < bestS) { bestS = sc; best = c; }
        }
        out[i] = best;
      }
      return out as FaceId[];
    }
    let best: FaceId[] = cands.map((c) => c[0]);
    let bestS = Infinity;
    const tries = 36;
    for (let t = 0; t < tries; t++) {
      let deco = false;
      const pick = cands.map((c, i) => {
        const pool = c.filter((f) => !(FACES[f].decorative && (deco || roles[i] === 'head')));
        const list = pool.length ? pool : c;
        const total = list.reduce((s, f) => s + FACES[f].weight, 0);
        let r = rand() * total;
        for (const f of list) {
          r -= FACES[f].weight;
          if (r <= 0) { if (FACES[f].decorative) deco = true; return f; }
        }
        return list[list.length - 1];
      });
      const sc = this.score(texts, pick, roles, rand() * 0.9);
      if (sc < bestS) { bestS = sc; best = pick; }
    }
    // Then improve it one line at a time, as a compositor swaps a line into another font.
    bestS = this.score(texts, best, roles, 0);
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        for (const c of cands[i]) {
          if (c === best[i]) continue;
          if (FACES[c].decorative && (roles[i] === 'head' || best.some((f, j) => j !== i && FACES[f].decorative))) continue;
          const trial = best.slice();
          trial[i] = c;
          const sc = this.score(texts, trial, roles, 0);
          if (sc < bestS - 1e-6) { bestS = sc; best = trial; improved = true; }
        }
      }
      if (!improved) break;
    }
    return best;
  }

  /** Set a poster. `faces` (one per input line) keeps an existing assignment where it still works. */
  set(input: LineInput[], seed: number, faces?: (FaceId | null)[], editing = -1): PosterLayout {
    const active: { index: number; text: string; ink2: boolean }[] = [];
    input.slice(0, MAX_LINES).forEach((l, index) => {
      const text = normalize(l.text).slice(0, MAX_CHARS);
      if (text.length) active.push({ index, text, ink2: !!l.ink2 });
    });
    const outFaces: (FaceId | null)[] = input.map(() => null);
    if (!active.length) return { lines: [], ornaments: [], faces: outFaces, status: 'underfull', slack: COLUMN };
    const texts = active.map((a) => a.text);
    const prev = faces ? active.map((a) => faces[a.index] ?? null) : undefined;
    const assigned = this.assign(texts, seed, prev, editing === -2 ? -2 : active.findIndex((a) => a.index === editing));
    active.forEach((a, i) => { outFaces[a.index] = assigned[i]; });
    const roles = this.roles(texts);
    const items = this.items(texts, assigned, roles);
    const { hs, status } = this.solve(items);

    // Exact settings for each line: real metrics at the chosen width, size from the measure.
    const lines: SetLine[] = [];
    const heights: number[] = [];
    items.forEach((it, i) => {
      const def = FACES[it.fit.face];
      const a = active[i];
      let wdth: number | null = null;
      let m: LineMetrics;
      let size: number;
      let x: number;
      let flanks: SetLine['flanks'] = null;
      if (it.mode === 'fill') {
        wdth = def.wdth ? TypeCase.q(Setter.widthFor(it.fit, hs[i])) : null;
        m = this.tc.measure(it.fit.face, wdth, it.fit.text);
        size = MEASURE / (m.inkR - m.inkL);
        x = SHEET.mx - m.inkL * size;
      } else {
        wdth = it.fit.wMid;
        m = this.tc.measure(it.fit.face, wdth, it.fit.text);
        const hEm = m.top - m.bottom;
        size = hs[i] / hEm;
        const inkW = (m.inkR - m.inkL) * size;
        const left = SHEET.mx + (MEASURE - inkW) / 2;
        x = left - m.inkL * size;
        const gap = Math.max(0.18, 0.55 * m.cap * size);
        if (left - gap - SHEET.mx > 0.25) flanks = { l: [SHEET.mx, left - gap], r: [left + inkW + gap, SHEET.mx + MEASURE] };
      }
      heights.push((m.top - m.bottom) * size);
      lines.push({
        index: a.index, text: it.fit.text, face: it.fit.face, wdth, size, x, baseline: 0,
        ink: { left: x + m.inkL * size, right: x + m.inkR * size, top: 0, bottom: 0 },
        capTop: 0, mode: it.mode, role: it.role, ink2: a.ink2,
        glyphs: m.glyphs.map((g) => ({ id: g.id, x: x + g.x * size })), flanks,
      });
      (lines[lines.length - 1] as SetLine & { _m: LineMetrics })._m = m;
    });

    // Stack: gaps take up the last fraction of an inch so the stack meets both margins exactly.
    const gaps: number[] = [];
    for (let i = 1; i < heights.length; i++) gaps.push(gapBetween(heights[i - 1], heights[i]));
    const used = heights.reduce((s, h) => s + h, 0) + gaps.reduce((s, g) => s + g, 0);
    let slack = COLUMN - used;
    let padTop = 0;
    const ornaments: Ornament[] = [];
    if (gaps.length) {
      const per = slack / gaps.length;
      for (let i = 0; i < gaps.length; i++) gaps[i] = Math.max(0.06, gaps[i] + per);
    } else {
      padTop = Math.max(0, slack / 2);
    }
    let y = SHEET.mt + padTop;
    lines.forEach((l, i) => {
      const m = (l as SetLine & { _m: LineMetrics })._m;
      delete (l as Partial<SetLine & { _m: LineMetrics }>)._m;
      l.baseline = y + m.top * l.size;
      l.ink.top = y;
      l.ink.bottom = l.baseline - m.bottom * l.size;
      l.capTop = l.baseline - m.cap * l.size;
      y = l.ink.bottom + (i < gaps.length ? gaps[i] : 0);
    });
    const extra = Math.max(0, slack);
    // Generous gaps get a rule, as a compositor would set brass between groups.
    const normal = 0.32;
    for (let i = 0; i < gaps.length; i++) {
      if (gaps[i] > normal * 3.2) {
        const yMid = (lines[i].ink.bottom + lines[i + 1].ink.top) / 2;
        ornaments.push({ kind: 'rule', x0: SHEET.mx, x1: SHEET.mx + MEASURE, y: yMid, h: 0.16 });
      }
    }
    if (padTop > 1.4) {
      ornaments.push({ kind: 'stars', x0: SHEET.mx + MEASURE * 0.2, x1: SHEET.mx + MEASURE * 0.8, y: SHEET.mt + padTop / 2, h: 0.5 });
      ornaments.push({ kind: 'stars', x0: SHEET.mx + MEASURE * 0.2, x1: SHEET.mx + MEASURE * 0.8, y: SHEET.h - SHEET.mb - padTop / 2, h: 0.5 });
    }
    return { lines, ornaments, faces: outFaces, status, slack: status === 'underfull' ? extra : 0 };
  }
}
