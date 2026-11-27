// Which file each face is loaded from (Latin subset only).
import type { FaceId } from './faces';

export const FONT_FILES: Record<FaceId, string> = {
  gothic: '@fontsource-variable/science-gothic/files/science-gothic-latin-wdth-normal.woff2',
  sixcaps: '@fontsource/six-caps/files/six-caps-latin-400-normal.woff2',
  league: '@fontsource-variable/league-gothic/files/league-gothic-latin-wdth-normal.woff2',
  clarendon: '@fontsource-variable/roboto-serif/files/roboto-serif-latin-wdth-normal.woff2',
  fat: '@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff2',
  ultra: '@fontsource/ultra/files/ultra-latin-400-normal.woff2',
  holtwood: '@fontsource/holtwood-one-sc/files/holtwood-one-sc-latin-400-normal.woff2',
  rye: '@fontsource/rye/files/rye-latin-400-normal.woff2',
};
