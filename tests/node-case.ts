// Loads the real font files from node_modules for the unit tests.
import { readFileSync } from 'node:fs';
import { create, registerFormat } from 'fontkit/core';
import { WOFF2Font } from 'fontkit/formats/WOFF2Font';
import type { FkFont } from 'fontkit/core';
import { FONT_FILES } from '../src/engine/fontfiles';
import { FACE_IDS, type FaceId } from '../src/engine/faces';
import { TypeCase } from '../src/engine/typecase';
import { Setter } from '../src/engine/setter';

registerFormat(WOFF2Font);

export function nodeSetter(root = process.cwd()): Setter {
  const fonts = {} as Record<FaceId, FkFont>;
  for (const id of FACE_IDS) fonts[id] = create(new Uint8Array(readFileSync(`${root}/node_modules/${FONT_FILES[id]}`)));
  return new Setter(new TypeCase(fonts));
}
