// The type case: every face the shop sets with. Variable faces fit a line by their width axis;
// fixed faces fit by size alone and give the set the contrast a real wood type case has.

export type FaceId = 'gothic' | 'sixcaps' | 'league' | 'clarendon' | 'fat' | 'ultra' | 'holtwood' | 'rye';

export interface FaceDef {
  id: FaceId;
  /** Name of the typeface as published. */
  family: string;
  /** What a compositor would call this kind of wood type. */
  kind: string;
  /** Fixed axis settings (weight). */
  axes: Record<string, number>;
  /** Width axis range used for fitting, or null for a fixed face. */
  wdth: [number, number] | null;
  /** Shortest and longest line (in letters) this face is willing to set. */
  minChars: number;
  maxChars: number;
  /** Can carry the biggest line on the sheet. */
  headliner: boolean;
  /** Good for small catch lines ("and", "at the"). */
  catchLine: boolean;
  /** Decorative: at most one line per poster, never the headliner. */
  decorative: boolean;
  /** Relative chance of being picked in a shuffle. */
  weight: number;
}

export const FACES: Record<FaceId, FaceDef> = {
  gothic: { id: 'gothic', family: 'Science Gothic', kind: 'Gothic, condensed to extended', axes: { wght: 880 }, wdth: [50, 200], minChars: 1, maxChars: 99, headliner: true, catchLine: false, decorative: false, weight: 5 },
  sixcaps: { id: 'sixcaps', family: 'Six Caps', kind: 'Extra condensed gothic', axes: {}, wdth: null, minChars: 6, maxChars: 99, headliner: true, catchLine: false, decorative: false, weight: 3 },
  league: { id: 'league', family: 'League Gothic', kind: 'Condensed gothic', axes: {}, wdth: [75, 100], minChars: 5, maxChars: 99, headliner: true, catchLine: false, decorative: false, weight: 3 },
  clarendon: { id: 'clarendon', family: 'Roboto Serif', kind: 'Heavy serif, condensed to wide', axes: { wght: 900 }, wdth: [50, 150], minChars: 3, maxChars: 26, headliner: true, catchLine: false, decorative: false, weight: 3 },
  fat: { id: 'fat', family: 'Abril Fatface', kind: 'Fat face', axes: {}, wdth: null, minChars: 2, maxChars: 20, headliner: false, catchLine: true, decorative: false, weight: 2 },
  ultra: { id: 'ultra', family: 'Ultra', kind: 'Heavy slab', axes: {}, wdth: null, minChars: 3, maxChars: 14, headliner: true, catchLine: false, decorative: false, weight: 2 },
  holtwood: { id: 'holtwood', family: 'Holtwood One SC', kind: 'Extended slab', axes: {}, wdth: null, minChars: 1, maxChars: 11, headliner: true, catchLine: false, decorative: false, weight: 2 },
  rye: { id: 'rye', family: 'Rye', kind: 'Decorated', axes: {}, wdth: null, minChars: 3, maxChars: 12, headliner: false, catchLine: false, decorative: true, weight: 1 },
};

export const FACE_IDS = Object.keys(FACES) as FaceId[];
