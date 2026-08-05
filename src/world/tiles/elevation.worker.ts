/// <reference lib="webworker" />
/**
 * Decodes elevation PNGs off the main thread and, when asked, renders the
 * stylised fallback texture from the same data.
 */

import { TILE_PIXELS, decodeElevation, heightStats, type ElevationEncoding } from '../terrarium';
import { stylizeElevation } from '../stylize';

export interface DecodeRequest {
  type: 'decode';
  key: number;
  buffer: ArrayBuffer;
  encoding: ElevationEncoding;
  /** Ground metres per elevation sample, for hillshade slope. */
  metersPerSample: number;
  wantTexture: boolean;
}

export interface DecodeResponse {
  type: 'decoded';
  key: number;
  heights: Float32Array;
  size: number;
  min: number;
  max: number;
  texture?: ImageBitmap;
}

export interface DecodeError {
  type: 'error';
  key: number;
  message: string;
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function context(size: number): OffscreenCanvasRenderingContext2D {
  if (!canvas || canvas.width !== size) {
    canvas = new OffscreenCanvas(size, size);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) throw new Error('2d context unavailable in worker');
  return ctx;
}

async function handle(req: DecodeRequest): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([req.buffer]));
  const size = bitmap.width || TILE_PIXELS;
  const c = context(size);
  c.clearRect(0, 0, size, size);
  c.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = c.getImageData(0, 0, size, size);
  const heights = decodeElevation(image.data, req.encoding);
  const stats = heightStats(heights);

  const transfer: Transferable[] = [heights.buffer];
  let texture: ImageBitmap | undefined;
  if (req.wantTexture) {
    const rgba = stylizeElevation(heights, { size, metersPerSample: req.metersPerSample });
    const styled = new ImageData(rgba, size, size);
    texture = await createImageBitmap(styled);
    transfer.push(texture);
  }

  const response: DecodeResponse = {
    type: 'decoded',
    key: req.key,
    heights,
    size,
    min: stats.min,
    max: stats.max,
    texture,
  };
  (self as unknown as Worker).postMessage(response, transfer);
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const req = e.data;
  if (req.type !== 'decode') return;
  handle(req).catch((err: unknown) => {
    const message: DecodeError = {
      type: 'error',
      key: req.key,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(message);
  });
};
