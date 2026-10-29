import { Canvas, createCanvas, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import * as path from 'path';

// Shared look of the OSRS cards: drawn at the game's own pixel size, then scaled up with
// nearest-neighbour so the pixel fonts and icons stay crisp. Icons are from the OSRS Wiki;
// fonts from RuneStar (CC0).

export const ASSETS = path.join(__dirname, '..', 'assets', 'osrs');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'RuneScape-Plain-12.ttf'), 'RS Plain');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'RuneScape-Bold-12.ttf'), 'RS Bold');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'RuneScape-Plain-11.ttf'), 'RS Small');

export const SCALE = 2;
export const PAD = 6;

export const COLOR = {
  edge: '#2b241b',
  bg: '#3e3529',
  cell: '#4a4134',
  hi: '#6b5f4c',
  lo: '#2a241c',
  yellow: '#ffff00',
  orange: '#ff981f',
  white: '#ffffff',
  grey: '#9f9f9f',
  green: '#00c000',
  red: '#ff3030',
  barBg: '#1b1712',
};

export interface TextStyle {
  font?: string;
  color?: string;
  align?: 'left' | 'right' | 'center';
}

/** Text with the game's 1px black drop shadow. */
export function text(ctx: SKRSContext2D, str: string, x: number, y: number, style: TextStyle = {}): void {
  ctx.font = style.font ?? '16px "RS Plain"';
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = style.color ?? COLOR.yellow;
  ctx.fillText(str, x, y);
}

/** A stone slot: lighter top-left edge, darker bottom-right. */
export function bevel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, fill = COLOR.cell): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLOR.hi;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = COLOR.lo;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** A blank card background at 1x. */
export function card(w: number, h: number): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COLOR.edge;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(1, 1, w - 2, h - 2);
  return { canvas, ctx };
}

/** The card scaled up to its final size, as a PNG. */
export function toPng(canvas: Canvas): Promise<Buffer> {
  const out = createCanvas(canvas.width * SCALE, canvas.height * SCALE);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.encode('png');
}
