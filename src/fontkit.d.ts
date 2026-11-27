// Minimal types for the parts of fontkit this project uses.
declare module 'fontkit/core' {
  export interface FkBBox { minX: number; minY: number; maxX: number; maxY: number }
  export interface FkPath { toSVG(): string; bbox: FkBBox; commands: { command: string; args: number[] }[]; scale(x: number, y: number): FkPath; translate(x: number, y: number): FkPath }
  export interface FkGlyph { id: number; path: FkPath; bbox: FkBBox; advanceWidth: number; codePoints: number[] }
  export interface FkPosition { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }
  export interface FkRun { glyphs: FkGlyph[]; positions: FkPosition[] }
  export interface FkFont {
    unitsPerEm: number;
    capHeight: number;
    ascent: number;
    descent: number;
    familyName: string;
    variationAxes: Record<string, { min: number; default: number; max: number }>;
    getVariation(settings: Record<string, number>): FkFont;
    layout(text: string, features?: Record<string, boolean> | string[]): FkRun;
    hasGlyphForCodePoint(cp: number): boolean;
    glyphForCodePoint(cp: number): FkGlyph;
    getGlyph(id: number): FkGlyph;
  }
  export function create(data: Uint8Array): FkFont;
  export function registerFormat(format: unknown): void;
}
declare module 'fontkit/formats/WOFF2Font' { export const WOFF2Font: unknown }
declare module 'fontkit/formats/TTFFont' { export const TTFFont: unknown }
