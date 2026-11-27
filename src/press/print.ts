// The print. The forme is drawn as an ink mask (one channel per ink pass, plus how much wood grain
// each line shows), then a shader presses it into paper: uneven pressure, salt in big flat areas,
// a squeezed rim at the edges, chipped corners, grain, paper tooth and a light bite into the sheet.
// Everything comes from one seed, so the saved PNG is the print that was on screen.
import { SHEET, type PosterLayout } from '../engine/setter';
import type { TypeCase } from '../engine/typecase';
import { mulberry32 } from '../engine/rng';
import { drawShapes, posterShapes } from './shapes';

export const PRINT_PPI = 100;
export const PRINT_W = SHEET.w * PRINT_PPI;
export const PRINT_H = SHEET.h * PRINT_PPI;

export interface PrintParams { paper: string; ink1: string; ink2: string; seed: number }

function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return c as [number, number, number];
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const BLUR = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(uTex, vUv) * 0.1964825501511404;
  s += (texture2D(uTex, vUv + uStep * 1.411764705882353) + texture2D(uTex, vUv - uStep * 1.411764705882353)) * 0.2969069646728344;
  s += (texture2D(uTex, vUv + uStep * 3.2941176470588234) + texture2D(uTex, vUv - uStep * 3.2941176470588234)) * 0.09447039785044732;
  s += (texture2D(uTex, vUv + uStep * 5.176470588235294) + texture2D(uTex, vUv - uStep * 5.176470588235294)) * 0.010381362401148057;
  gl_FragColor = s;
}`;

const PRESS = `
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uNear;
uniform sampler2D uWide;
uniform vec2 uSheet;
uniform vec2 uTexel;
uniform vec3 uPaper;
uniform vec3 uInk1;
uniform vec3 uInk2;
uniform vec2 uSeed;
uniform vec2 uTilt;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + uSeed);
  float b = hash12(i + vec2(1.0, 0.0) + uSeed);
  float c = hash12(i + vec2(0.0, 1.0) + uSeed);
  float d = hash12(i + vec2(1.0, 1.0) + uSeed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.07 + vec2(17.13, 9.71); a *= 0.5; }
  return s / 0.9375;
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 inkOver(vec3 base, vec3 ink, float d) {
  vec3 A = -log(max(ink, vec3(0.003)));
  vec3 trans = base * exp(-A * d);
  vec3 opaque = mix(base, ink, clamp(d, 0.0, 1.0));
  return mix(trans, opaque, 0.45);
}

// How much ink one pass lays down here.
float pass(float mask, float near, float wide, float grainAmt, vec2 p, vec2 off, float P) {
  // Ragged, worn edge: the threshold on the blurred forme wanders, so corners chip and edges rag.
  float edgeN = fbm(p * 34.0 + off);
  float wear = smoothstep(0.62, 0.9, noise(p * 6.5 + off * 3.0));
  float t = 0.5 + (edgeN - 0.5) * 0.5 + (0.55 - P) * 0.16 + wear * 0.22;
  float cover = smoothstep(t - 0.06, t + 0.06, near);
  if (cover <= 0.0) return 0.0;
  // Interior of wide strokes and big letters, where salt shows.
  float inner = smoothstep(0.9, 0.995, near);
  float big = smoothstep(0.55, 0.98, wide);
  // Salt: specks of paper where the ink did not take. Sparse where the pressure is good,
  // gathering into patches where it is light, and mostly in the big flat areas.
  float speck = fbm(p * 42.0 + off * 1.7);
  float cluster = noise(p * 5.0 + off);
  float thr = 0.15 + 0.19 * smoothstep(0.6, 0.12, P) + 0.1 * smoothstep(0.6, 0.95, cluster) + 0.04 * big;
  float salt = mix(1.0, smoothstep(thr - 0.035, thr + 0.035, speck), inner * (0.35 + 0.65 * big));
  // The squeezed rim: ink pushed to the edge of the type is denser.
  float rim = (1.0 - smoothstep(0.55, 0.97, near)) * cover;
  // Wood grain running down the big letters.
  float warp = fbm(vec2(p.x * 0.9, p.y * 0.16) + off) * 3.4;
  float streak = sin((p.x * 6.5 + warp + 0.6 * noise(vec2(p.x * 2.0, p.y * 0.05) + off)) * 6.2831853);
  float knot = smoothstep(0.35, 0.8, noise(vec2(p.x * 1.6, p.y * 0.35) + off * 0.5));
  float grain = smoothstep(0.72, 1.0, streak * 0.5 + 0.5) * knot;
  float g = grainAmt * inner;
  float d = cover * salt * (0.92 + 0.08 * P) * (1.0 - g * grain * 0.22);
  d = min(1.0, d * (1.0 + 0.12 * rim));
  return d;
}

void main() {
  vec2 p = vUv * uSheet;
  vec4 m = texture2D(uMask, vUv);
  vec4 n = texture2D(uNear, vUv);
  vec4 w = texture2D(uWide, vUv);
  // Uneven pressure across the sheet: broad patches plus a slight tilt of the platen.
  float P = fbm(p * 0.16 + vec2(3.1, 7.7));
  P = clamp(0.5 + (P - 0.5) * 1.7 + (vUv.x - 0.5) * uTilt.x + (vUv.y - 0.5) * uTilt.y, 0.0, 1.0);
  // Paper: tooth, mottle and the bite of the type into the sheet.
  float tooth = fbm(p * 70.0 + vec2(5.0, 1.0));
  float mottle = fbm(p * 1.3 + vec2(11.0, 4.0));
  float wl = texture2D(uWide, vUv - uTexel * vec2(2.0, 2.0)).r + texture2D(uWide, vUv - uTexel * vec2(2.0, 2.0)).g;
  float wr = texture2D(uWide, vUv + uTexel * vec2(2.0, 2.0)).r + texture2D(uWide, vUv + uTexel * vec2(2.0, 2.0)).g;
  float bite = (wr - wl) * 0.5;
  vec3 paper = uPaper * (0.955 + 0.07 * tooth) * (0.985 + 0.03 * mottle) * (1.0 + bite * 0.07);
  float grainAmt = clamp(m.b / max(0.0001, max(m.r, m.g)), 0.0, 1.0);
  float d1 = pass(m.r, n.r, w.r, grainAmt, p, vec2(0.0), P);
  float d2 = pass(m.g, n.g, w.g, grainAmt, p, vec2(41.7, 13.3), P);
  // Ink sits on the peaks of the paper tooth.
  float tk = 0.9 + 0.16 * tooth;
  vec3 c = inkOver(paper, uInk1, d1 * tk);
  c = inkOver(c, uInk2, d2 * tk);
  gl_FragColor = vec4(toSrgb(c), 1.0);
}`;

function compile(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

export class Printer {
  private tc: TypeCase;
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private progBlur: WebGLProgram | null = null;
  private progPress: WebGLProgram | null = null;
  private lost = false;
  readonly mask: HTMLCanvasElement;
  readonly timing = { mask: 0, gpu: 0, copy: 0 };

  constructor(tc: TypeCase) {
    this.tc = tc;
    this.mask = document.createElement('canvas');
    this.mask.width = PRINT_W;
    this.mask.height = PRINT_H;
  }

  private setup(): boolean {
    if (new URLSearchParams(location.search).has('flat')) return false;
    if (this.gl && !this.lost) return true;
    try {
      const c = document.createElement('canvas');
      c.width = PRINT_W;
      c.height = PRINT_H;
      const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
      if (!gl) return false;
      const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!hp || hp.precision < 16) return false;
      if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < PRINT_H) return false;
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
      c.addEventListener('webglcontextrestored', () => { this.gl = null; this.lost = false; });
      this.progBlur = compile(gl, VERT, BLUR);
      this.progPress = compile(gl, VERT, PRESS);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.glCanvas = c;
      this.gl = gl;
      return true;
    } catch {
      return false;
    }
  }

  /** Compile the shaders ahead of the first pull. */
  warm() {
    if (!this.setup()) return;
    const gl = this.gl!;
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(this.progBlur);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(this.progPress);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  /** Draw the forme as an ink mask: red channel ink one, green ink two, blue the grain. */
  private drawMask(L: PosterLayout, seed: number) {
    const ctx = this.mask.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PRINT_W, PRINT_H);
    ctx.globalCompositeOperation = 'lighter';
    const rand = mulberry32(seed * 7919 + 13);
    const shapes = posterShapes(this.tc, L);
    // Second pass out of register: shifted and turned a hair.
    const reg = { dx: (rand() - 0.5) * 0.09, dy: (rand() - 0.3) * 0.07, rot: (rand() - 0.5) * 0.004 };
    const lineShift = L.lines.map(() => [(rand() - 0.5) * 0.02, (rand() - 0.5) * 0.025]);
    const grainOf = L.lines.map((l) => {
      const cap = l.baseline - l.capTop;
      return Math.round(255 * Math.min(1, Math.max(0, (cap - 1.6) / 2.6)) * (0.5 + 0.5 * rand()));
    });
    const jit = shapes.map((s) => {
      const k = s.kind === 'glyph' ? 1 : 0.4;
      return [(rand() - 0.5) * 0.014 * k, (rand() - 0.5) * 0.014 * k, (rand() - 0.5) * 0.009 * k, 1 + (rand() - 0.5) * 0.006 * k] as [number, number, number, number];
    });
    for (const ink of [1, 2] as const) {
      ctx.save();
      if (ink === 2) {
        ctx.translate(PRINT_W / 2 + reg.dx * PRINT_PPI, PRINT_H / 2 + reg.dy * PRINT_PPI);
        ctx.rotate(reg.rot);
        ctx.translate(-PRINT_W / 2, -PRINT_H / 2);
      }
      drawShapes(ctx, this.tc, shapes, {
        ppi: PRINT_PPI,
        color1: '#000', color2: '#000',
        filter: (s) => s.ink === ink,
        color: (s) => {
          const g = s.line >= 0 ? grainOf[s.line] : 0;
          return ink === 1 ? `rgb(255,0,${g})` : `rgb(0,255,${g})`;
        },
        jitter: (s, i) => {
          const j = jit[i];
          if (s.line >= 0) return [j[0] + lineShift[s.line][0], j[1] + lineShift[s.line][1], j[2], j[3]];
          return j;
        },
      }, SHEET.w);
      ctx.restore();
    }
    return rand;
  }

  /** Render the print at 100 pixels per inch into `out` (resized to the print). */
  render(L: PosterLayout, p: PrintParams, out: HTMLCanvasElement): 'webgl' | 'flat' {
    out.width = PRINT_W;
    out.height = PRINT_H;
    const t0 = performance.now();
    const rand = this.drawMask(L, p.seed);
    this.timing.mask = performance.now() - t0;
    const octx = out.getContext('2d')!;
    if (!this.setup()) {
      this.flat(L, p, octx);
      return 'flat';
    }
    const gl = this.gl!;
    const tex = (src: TexImageSource | null) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PRINT_W, PRINT_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    };
    const maskT = tex(this.mask);
    const tA = tex(null), tB = tex(null), tC = tex(null);
    const fbs = [tA, tB, tC].map((t) => {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return fb;
    });
    gl.viewport(0, 0, PRINT_W, PRINT_H);
    gl.useProgram(this.progBlur);
    const uStep = gl.getUniformLocation(this.progBlur!, 'uStep');
    gl.uniform1i(gl.getUniformLocation(this.progBlur!, 'uTex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    const blur = (src: WebGLTexture, dst: WebGLFramebuffer, dx: number, dy: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform2f(uStep, dx / PRINT_W, dy / PRINT_H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // Near blur (about 2 px): edges, rim, corners. Wide blur: big flat areas and the bite.
    blur(maskT, fbs[0], 0.75, 0);
    blur(tA, fbs[1], 0, 0.75); // tB = near
    blur(tB, fbs[0], 3.5, 0);
    blur(tA, fbs[2], 0, 3.5); // tC = wide
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.progPress);
    const pr = this.progPress!;
    const u = (n: string) => gl.getUniformLocation(pr, n);
    gl.uniform1i(u('uMask'), 0);
    gl.uniform1i(u('uNear'), 1);
    gl.uniform1i(u('uWide'), 2);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskT);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tB);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tC);
    gl.uniform2f(u('uSheet'), SHEET.w, SHEET.h);
    gl.uniform2f(u('uTexel'), 1 / PRINT_W, 1 / PRINT_H);
    gl.uniform3fv(u('uPaper'), hexToLinear(p.paper));
    gl.uniform3fv(u('uInk1'), hexToLinear(p.ink1));
    gl.uniform3fv(u('uInk2'), hexToLinear(p.ink2));
    gl.uniform2f(u('uSeed'), Math.floor(rand() * 900) + 50, Math.floor(rand() * 900) + 50);
    gl.uniform2f(u('uTilt'), (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const t1 = performance.now();
    octx.drawImage(this.glCanvas!, 0, 0);
    this.timing.gpu = t1 - t0 - this.timing.mask;
    this.timing.copy = performance.now() - t1;
    gl.activeTexture(gl.TEXTURE0);
    for (const t of [maskT, tA, tB, tC]) gl.deleteTexture(t);
    for (const f of fbs) gl.deleteFramebuffer(f);
    return 'webgl';
  }

  /** Without WebGL: flat ink with a little unevenness, still seeded. */
  private flat(L: PosterLayout, p: PrintParams, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = p.paper;
    ctx.fillRect(0, 0, PRINT_W, PRINT_H);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const shapes = posterShapes(this.tc, L);
    const rand = mulberry32(p.seed);
    drawShapes(ctx, this.tc, shapes, { ppi: PRINT_PPI, color1: p.ink1, color2: p.ink2, jitter: () => [(rand() - 0.5) * 0.01, (rand() - 0.5) * 0.01, (rand() - 0.5) * 0.006, 1] }, SHEET.w);
    ctx.restore();
  }
}
