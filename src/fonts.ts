// Loads the type case in the browser: each font file is fetched once, parsed for the poster engine,
// and registered as a CSS font for the page around it.
import { create, registerFormat, type FkFont } from 'fontkit/core';
import { WOFF2Font } from 'fontkit/formats/WOFF2Font';
import gothic from '@fontsource-variable/science-gothic/files/science-gothic-latin-wdth-normal.woff2?url';
import sixcaps from '@fontsource/six-caps/files/six-caps-latin-400-normal.woff2?url';
import league from '@fontsource-variable/league-gothic/files/league-gothic-latin-wdth-normal.woff2?url';
import clarendon from '@fontsource-variable/roboto-serif/files/roboto-serif-latin-wdth-normal.woff2?url';
import fat from '@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff2?url';
import ultra from '@fontsource/ultra/files/ultra-latin-400-normal.woff2?url';
import holtwood from '@fontsource/holtwood-one-sc/files/holtwood-one-sc-latin-400-normal.woff2?url';
import rye from '@fontsource/rye/files/rye-latin-400-normal.woff2?url';
import type { FaceId } from './engine/faces';

registerFormat(WOFF2Font);

const URLS: Record<FaceId, string> = { gothic, sixcaps, league, clarendon, fat, ultra, holtwood, rye };

/** CSS families for the page itself. */
const CSS: Partial<Record<FaceId, [string, FontFaceDescriptors]>> = {
  gothic: ['TO Gothic', { weight: '100 900', stretch: '50% 200%' }],
  league: ['TO League', { stretch: '75% 100%' }],
  clarendon: ['TO Serif', { weight: '100 900', stretch: '50% 150%' }],
};

export async function loadCase(): Promise<Record<FaceId, FkFont>> {
  const ids = Object.keys(URLS) as FaceId[];
  const bufs = await Promise.all(ids.map((id) => fetch(URLS[id]).then((r) => {
    if (!r.ok) throw new Error('Font failed to load: ' + id);
    return r.arrayBuffer();
  })));
  const fonts = {} as Record<FaceId, FkFont>;
  const faces: Promise<FontFace>[] = [];
  ids.forEach((id, i) => {
    fonts[id] = create(new Uint8Array(bufs[i]));
    const css = CSS[id];
    if (css) {
      const ff = new FontFace(css[0], bufs[i], css[1]);
      faces.push(ff.load().then((f) => { document.fonts.add(f); return f; }));
    }
  });
  await Promise.all(faces);
  return fonts;
}
