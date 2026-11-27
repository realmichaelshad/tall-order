import { describe, it, expect, beforeAll } from 'vitest';
import { nodeSetter } from './node-case';
import { Setter, SHEET, MEASURE, COLUMN, MAX_LINES, normalize, type PosterLayout } from '../src/engine/setter';
import { FACES } from '../src/engine/faces';

// The print is made at 100 pixels per inch, so "a pixel" is 0.01 inch on the sheet.
const PX = 1 / 100;
let S: Setter;
beforeAll(() => { S = nodeSetter(); });

const set = (lines: string[], seed = 1) => S.set(lines.map((text) => ({ text })), seed);

function checkMeasure(L: PosterLayout) {
  for (const l of L.lines) {
    if (l.mode === 'fill') {
      expect(Math.abs(l.ink.left - SHEET.mx)).toBeLessThan(PX);
      expect(Math.abs(l.ink.right - (SHEET.mx + MEASURE))).toBeLessThan(PX);
    } else {
      // Flanked lines are centred and their rules run out to both edges.
      expect(Math.abs((l.ink.left + l.ink.right) / 2 - SHEET.w / 2)).toBeLessThan(PX);
      if (l.flanks) {
        expect(Math.abs(l.flanks.l[0] - SHEET.mx)).toBeLessThan(PX);
        expect(Math.abs(l.flanks.r[1] - (SHEET.mx + MEASURE))).toBeLessThan(PX);
      }
    }
  }
}

function checkStack(L: PosterLayout) {
  for (let i = 1; i < L.lines.length; i++) expect(L.lines[i].ink.top).toBeGreaterThan(L.lines[i - 1].ink.bottom);
  for (const l of L.lines) {
    expect(l.ink.top).toBeGreaterThanOrEqual(SHEET.mt - PX);
    expect(l.ink.bottom).toBeLessThanOrEqual(SHEET.h - SHEET.mb + PX);
  }
}

function checkFullHeight(L: PosterLayout) {
  expect(Math.abs(L.lines[0].ink.top - SHEET.mt)).toBeLessThan(PX);
  expect(Math.abs(L.lines[L.lines.length - 1].ink.bottom - (SHEET.h - SHEET.mb))).toBeLessThan(PX);
}

const STARTERS = [
  ['Grange hall', 'Saturday dance', 'with', 'The Hollow Creek Five', 'Doors at eight'],
  ['County fair', 'and', 'Pie contest', 'Sunday', 'Free gate'],
  ['Big Hollow', 'Brass band', 'night', 'Friday', 'at the', 'Bandstand'],
  ['Swap meet', 'Sunday', 'at the', 'Grange lot', 'Tools, quilts, jars', 'Coffee & pie'],
];

describe('fitting', () => {
  it('fills the measure within a pixel on every line', () => {
    for (const p of STARTERS) for (const seed of [1, 2, 3, 4]) checkMeasure(set(p, seed));
  });

  it('fills the sheet top to bottom', () => {
    for (const p of STARTERS) for (const seed of [1, 2, 3]) {
      const L = set(p, seed);
      checkStack(L);
      checkFullHeight(L);
    }
  });

  it('fills the sheet with type, not space, when the copy allows it', () => {
    for (const p of STARTERS.slice(1)) {
      const L = set(p, 1);
      // Any space the type cannot take is at most four percent of the column, spread over the gaps.
      expect(L.slack).toBeLessThan(0.04 * COLUMN);
    }
  });

  it('gives the same poster for the same input and seed', () => {
    const a = JSON.stringify(set(STARTERS[2], 7));
    const b = JSON.stringify(nodeSetter().set(STARTERS[2].map((text) => ({ text })), 7));
    expect(a).toBe(b);
  });

  it('changes faces when shuffled', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) seen.add(set(STARTERS[2], seed).faces.join());
    expect(seen.size).toBeGreaterThan(2);
  });

  it('never stretches glyphs: every line uses one size and the width axis of its face', () => {
    for (const p of STARTERS) for (const l of set(p).lines) {
      const def = FACES[l.face];
      if (def.wdth && l.mode === 'fill') {
        expect(l.wdth).not.toBeNull();
        expect(l.wdth!).toBeGreaterThanOrEqual(def.wdth[0]);
        expect(l.wdth!).toBeLessThanOrEqual(def.wdth[1]);
      }
      if (!def.wdth) expect(l.wdth).toBeNull();
      expect(l.size).toBeGreaterThan(0);
    }
  });

  it('lets one or two lines dominate', () => {
    for (const p of STARTERS.slice(1)) {
      const hs = set(p).lines.filter((l) => l.role !== 'catch').map((l) => l.ink.bottom - l.ink.top).sort((a, b) => b - a);
      expect(hs[0] / hs[Math.floor(hs.length / 2)]).toBeGreaterThan(1.15);
    }
  });

  it('sets connector words as small catch lines with rules', () => {
    const L = set(STARTERS[0]);
    const w = L.lines.find((l) => l.text === 'WITH')!;
    expect(w.role).toBe('catch');
    expect(w.flanks).not.toBeNull();
    expect(w.ink.bottom - w.ink.top).toBeLessThan(0.06 * COLUMN);
  });
});

describe('edge cases', () => {
  it('sets a single line', () => {
    const L = set(['Swap meet']);
    expect(L.lines).toHaveLength(1);
    checkMeasure(L);
    checkStack(L);
  });

  it('sets a single letter without towering past the sheet', () => {
    const L = set(['A']);
    expect(L.lines).toHaveLength(1);
    const l = L.lines[0];
    expect(l.ink.bottom - l.ink.top).toBeLessThanOrEqual(COLUMN + PX);
    checkMeasure(L);
    checkStack(L);
  });

  it('sets eight lines', () => {
    const L = set(['Brass band night', 'at the', 'Old Mill', '8 PM', 'Tickets 2 dollars', 'Bring a chair', 'Rain or shine', 'Café & bar']);
    expect(L.lines).toHaveLength(8);
    checkMeasure(L);
    checkStack(L);
    checkFullHeight(L);
  });

  it('sets eight one-letter lines', () => {
    const L = set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(L.lines).toHaveLength(8);
    checkMeasure(L);
    checkStack(L);
  });

  it('ignores lines past the eighth and blank lines', () => {
    const L = set(['One', '', '  ', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']);
    expect(L.lines.map((l) => l.index)).toEqual([0, 3, 4, 5, 6, 7]);
    expect(L.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('keeps a very long line readable', () => {
    const L = set(['A very long line of type that keeps on', 'Short']);
    const long = L.lines[0];
    checkMeasure(L);
    checkStack(L);
    expect(long.ink.bottom - long.ink.top).toBeGreaterThan(0.025 * COLUMN);
  });

  it('sets numbers, ampersands and accented letters', () => {
    const L = set(['1, 2, 3 & 4!', 'Ñandú & Ölstube', 'Crème brûlée']);
    expect(L.lines.map((l) => l.text)).toEqual(['1, 2, 3 & 4!', 'ÑANDÚ & ÖLSTUBE', 'CRÈME BRÛLÉE']);
    checkMeasure(L);
    checkStack(L);
  });

  it('leaves out characters no face has type for', () => {
    const L = set(['Swap meet \u{1F600}', 'Sunday']);
    expect(L.lines[0].text).toBe('SWAP MEET');
    checkMeasure(L);
  });

  it('normalizes case and spacing', () => {
    expect(normalize('  grange\t hall ')).toBe('GRANGE HALL');
    expect(normalize('straße')).toBe('STRASSE');
  });

  it('handles an empty poster', () => {
    expect(set(['', ' ']).lines).toHaveLength(0);
  });

  it('keeps the other lines in their faces while one line is typed letter by letter', () => {
    const base = ['County fair', 'and', 'Pie contest', 'Sunday'];
    let faces = set([...base, 'F']).faces;
    const first = faces.slice(0, 4).join();
    const word = 'Free gate';
    for (let k = 2; k <= word.length; k++) {
      const L = S.set([...base, word.slice(0, k)].map((text) => ({ text })), 1, faces);
      expect(L.faces.slice(0, 4).join()).toBe(first);
      faces = L.faces;
      checkMeasure(L);
      checkStack(L);
    }
  });
});

describe('typing', () => {
  it('lets the line being typed move to a better face without touching the others', () => {
    const base = ['Big Hollow', 'Brass band', 'night', 'Friday', 'at the'];
    const start = set([...base, 'Bandstand'], 1);
    // Retype the last line as a long one: only that line may change face.
    const L = S.set([...base, 'Bandstand and the old mill pond'].map((text) => ({ text })), 1, start.faces, 5);
    expect(L.faces.slice(0, 5)).toEqual(start.faces.slice(0, 5));
    checkMeasure(L);
    checkStack(L);
  });

  it('rebalances faces when lines are added or removed, and stays stable for the same input', () => {
    const eight = set(['Brass band night', 'at the', 'Old Mill', '8 PM', 'Tickets 2 dollars', 'Bring a chair', 'Rain or shine', 'Café & bar'], 1);
    const two = ['A very long line of type', 'Short'].map((text) => ({ text }));
    const a = S.set(two, 1, eight.faces.slice(0, 2), -2);
    const b = S.set(two, 1, eight.faces.slice(0, 2), -2);
    expect(a.faces).toEqual(b.faces);
    // The short line gets a face that makes it tall rather than staying in a face chosen for eight lines.
    const short = a.lines[1];
    expect(short.ink.bottom - short.ink.top).toBeGreaterThan(0.25 * COLUMN);
  });
});
