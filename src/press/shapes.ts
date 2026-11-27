// Turns a set poster into the pieces a press would print: glyphs, brass rules and stars.
import type { PosterLayout } from '../engine/setter';
import type { TypeCase } from '../engine/typecase';
import type { FaceId } from '../engine/faces';

export type Shape =
  | { kind: 'glyph'; ink: 1 | 2; line: number; face: FaceId; wdth: number | null; gid: number; x: number; y: number; size: number; cap: number }
  | { kind: 'rect'; ink: 1 | 2; line: number; x: number; y: number; w: number; h: number }
  | { kind: 'star'; ink: 1 | 2; line: number; x: number; y: number; r: number };

/** A thick-and-thin rule, the way brass rule is cut. */
function oxford(out: Shape[], ink: 1 | 2, line: number, x0: number, x1: number, yc: number, scale: number) {
  const thick = Math.min(0.13, Math.max(0.06, 0.09 * scale));
  const thin = Math.max(0.025, thick * 0.32);
  const gap = Math.max(0.04, thick * 0.55);
  const total = thick + gap + thin;
  out.push({ kind: 'rect', ink, line, x: x0, y: yc - total / 2, w: x1 - x0, h: thick });
  out.push({ kind: 'rect', ink, line, x: x0, y: yc - total / 2 + thick + gap, w: x1 - x0, h: thin });
}

export function posterShapes(tc: TypeCase, L: PosterLayout): Shape[] {
  const out: Shape[] = [];
  L.lines.forEach((l, li) => {
    const ink: 1 | 2 = l.ink2 ? 2 : 1;
    const cap = l.baseline - l.capTop;
    for (const g of l.glyphs) {
      const p = tc.glyphPath(l.face, l.wdth, g.id);
      if (!p) continue;
      out.push({ kind: 'glyph', ink, line: li, face: l.face, wdth: l.wdth, gid: g.id, x: g.x, y: l.baseline, size: l.size, cap });
    }
    if (l.flanks) {
      const yc = l.baseline - cap / 2;
      oxford(out, ink, li, l.flanks.l[0], l.flanks.l[1], yc, cap);
      oxford(out, ink, li, l.flanks.r[0], l.flanks.r[1], yc, cap);
    }
  });
  for (const o of L.ornaments) {
    if (o.kind === 'rule') oxford(out, 1, -1, o.x0, o.x1, o.y, 1);
    else {
      const n = 5;
      const r = Math.min(o.h * 0.5, 0.28);
      const step = (o.x1 - o.x0) / (n - 1);
      for (let i = 0; i < n; i++) out.push({ kind: 'star', ink: 2, line: -1, x: o.x0 + i * step, y: o.y, r });
    }
  }
  return out;
}

export function starPath(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, r: number) {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const pathCache = new Map<string, Path2D>();
export function glyphPath2D(tc: TypeCase, face: FaceId, wdth: number | null, gid: number): Path2D {
  const k = face + '@' + wdth + '#' + gid;
  let p = pathCache.get(k);
  if (!p) {
    p = new Path2D(tc.glyphPath(face, wdth, gid));
    pathCache.set(k, p);
    if (pathCache.size > 6000) pathCache.clear();
  }
  return p;
}

export interface DrawOpts {
  /** Pixels per inch. */
  ppi: number;
  color1: string;
  color2: string;
  /** Mirror left to right, as type sits in the forme. */
  mirror?: boolean;
  filter?: (s: Shape) => boolean;
  /** Overrides color1 and color2 per shape. */
  color?: (s: Shape) => string;
  /** Per-shape transform jitter for the print: returns [dx, dy, rotation, scale]. */
  jitter?: (s: Shape, i: number) => [number, number, number, number];
}

export function drawShapes(ctx: CanvasRenderingContext2D, tc: TypeCase, shapes: Shape[], o: DrawOpts, sheetW: number) {
  ctx.save();
  if (o.mirror) { ctx.translate(sheetW * o.ppi, 0); ctx.scale(-1, 1); }
  shapes.forEach((s, i) => {
    if (o.filter && !o.filter(s)) return;
    ctx.fillStyle = o.color ? o.color(s) : s.ink === 2 ? o.color2 : o.color1;
    const j = o.jitter ? o.jitter(s, i) : null;
    ctx.save();
    ctx.scale(o.ppi, o.ppi);
    if (s.kind === 'glyph') {
      ctx.translate(s.x, s.y);
      if (j) {
        // Wobble each letter about the middle of its cap height.
        ctx.translate(j[0], j[1] - s.cap / 2);
        ctx.rotate(j[2]);
        ctx.scale(j[3], j[3]);
        ctx.translate(0, s.cap / 2);
      }
      ctx.scale(s.size, -s.size);
      ctx.fill(glyphPath2D(tc, s.face, s.wdth, s.gid));
    } else if (s.kind === 'rect') {
      if (j) { ctx.translate(j[0], j[1]); }
      ctx.fillRect(s.x, s.y, s.w, s.h);
    } else {
      if (j) ctx.translate(j[0], j[1]);
      ctx.beginPath();
      starPath(ctx, s.x, s.y, s.r);
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.restore();
}
