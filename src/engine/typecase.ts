// Width-axis type measured from real glyph outlines. Each (face, width) pair is instanced from the
// variable font in JavaScript, so measuring, drawing and exporting never depend on how a browser
// handles font-variation settings in canvas.
import type { FkFont } from 'fontkit/core';
import { FACES, type FaceId } from './faces';

export interface GlyphBox { minX: number; maxX: number; minY: number; maxY: number; empty: boolean }

export interface LineMetrics {
  text: string;
  /** All values in em (font units divided by units per em), origin at the first glyph's origin. */
  inkL: number;
  inkR: number;
  top: number;
  bottom: number;
  cap: number;
  advance: number;
  glyphs: { id: number; x: number }[];
}

const MAX_INSTANCES = 600;

export class TypeCase {
  private base: Record<FaceId, FkFont>;
  private instances = new Map<string, FkFont>();
  private boxes = new Map<string, GlyphBox>();
  private metrics = new Map<string, LineMetrics>();
  private paths = new Map<string, string>();
  private caps = new Map<string, number>();

  constructor(fonts: Record<FaceId, FkFont>) {
    this.base = fonts;
  }

  /** Width values are rounded to the axis step (0.1) so instances can be cached. */
  static q(wdth: number | null): number | null {
    return wdth == null ? null : Math.round(wdth * 10) / 10;
  }

  font(face: FaceId, wdth: number | null): FkFont {
    const def = FACES[face];
    if (!def.wdth && Object.keys(def.axes).length === 0) return this.base[face];
    const w = TypeCase.q(wdth);
    const key = face + '@' + w;
    let f = this.instances.get(key);
    if (f) {
      this.instances.delete(key);
      this.instances.set(key, f);
      return f;
    }
    const settings: Record<string, number> = { ...def.axes };
    if (def.wdth && w != null) settings.wdth = Math.max(def.wdth[0], Math.min(def.wdth[1], w));
    f = this.base[face].getVariation(settings);
    this.instances.set(key, f);
    if (this.instances.size > MAX_INSTANCES) {
      const oldest = this.instances.keys().next().value as string;
      this.instances.delete(oldest);
    }
    return f;
  }

  supports(face: FaceId, ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    return this.base[face].hasGlyphForCodePoint(cp);
  }

  private key(face: FaceId, wdth: number | null): string {
    return face + '@' + TypeCase.q(wdth);
  }

  glyphBox(face: FaceId, wdth: number | null, gid: number): GlyphBox {
    const k = this.key(face, wdth) + '#' + gid;
    let b = this.boxes.get(k);
    if (b) return b;
    const f = this.font(face, wdth);
    const g = f.getGlyph(gid);
    const bb = g.path.bbox;
    const u = f.unitsPerEm;
    const empty = !(isFinite(bb.minX) && bb.maxX > bb.minX && bb.maxY > bb.minY);
    b = empty ? { minX: 0, maxX: 0, minY: 0, maxY: 0, empty } : { minX: bb.minX / u, maxX: bb.maxX / u, minY: bb.minY / u, maxY: bb.maxY / u, empty };
    this.boxes.set(k, b);
    return b;
  }

  /** Cap height measured from the H at this instance. */
  cap(face: FaceId, wdth: number | null): number {
    const k = this.key(face, wdth);
    let c = this.caps.get(k);
    if (c != null) return c;
    const f = this.font(face, wdth);
    const g = f.glyphForCodePoint(72);
    const b = this.glyphBox(face, wdth, g.id);
    c = b.empty ? f.capHeight / f.unitsPerEm : b.maxY;
    this.caps.set(k, c);
    return c;
  }

  measure(face: FaceId, wdth: number | null, text: string): LineMetrics {
    const k = this.key(face, wdth) + '|' + text;
    let m = this.metrics.get(k);
    if (m) return m;
    const f = this.font(face, wdth);
    const u = f.unitsPerEm;
    const run = f.layout(text, { liga: false, clig: false, dlig: false, calt: false });
    let x = 0;
    let inkL = Infinity, inkR = -Infinity, top = -Infinity, bottom = Infinity;
    const glyphs: { id: number; x: number }[] = [];
    for (let i = 0; i < run.glyphs.length; i++) {
      const g = run.glyphs[i];
      const p = run.positions[i];
      const gx = x + p.xOffset / u;
      glyphs.push({ id: g.id, x: gx });
      const b = this.glyphBox(face, wdth, g.id);
      if (!b.empty) {
        inkL = Math.min(inkL, gx + b.minX);
        inkR = Math.max(inkR, gx + b.maxX);
        top = Math.max(top, b.maxY + p.yOffset / u);
        bottom = Math.min(bottom, b.minY + p.yOffset / u);
      }
      x += p.xAdvance / u;
    }
    const cap = this.cap(face, wdth);
    if (!isFinite(inkL)) { inkL = 0; inkR = 0; top = cap; bottom = 0; }
    m = { text, inkL, inkR, top: Math.max(top, cap * 0.5), bottom: Math.min(bottom, 0), cap, advance: x, glyphs };
    this.metrics.set(k, m);
    if (this.metrics.size > 6000) this.metrics.clear();
    return m;
  }

  /** SVG path data for a glyph in em units, y pointing up. */
  glyphPath(face: FaceId, wdth: number | null, gid: number): string {
    const k = this.key(face, wdth) + '#' + gid;
    let p = this.paths.get(k);
    if (p != null) return p;
    const f = this.font(face, wdth);
    const s = 1 / f.unitsPerEm;
    p = f.getGlyph(gid).path.scale(s, s).toSVG();
    this.paths.set(k, p);
    if (this.paths.size > 8000) this.paths.clear();
    return p;
  }
}
