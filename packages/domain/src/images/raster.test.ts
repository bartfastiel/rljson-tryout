import { describe, expect, it } from 'vitest';

import type { RgbaImage } from './png.ts';
import {
  circle,
  createCanvas,
  ellipse,
  paint,
  triangle,
  type Rgba,
} from './raster.ts';

const red: Rgba = [255, 0, 0, 255];
const blue: Rgba = [0, 0, 255, 255];

const pixelAt = (image: RgbaImage, x: number, y: number): number[] => [
  ...image.pixels.subarray(
    (y * image.width + x) * 4,
    (y * image.width + x) * 4 + 4,
  ),
];

const opaquePixelCount = (image: RgbaImage): number => {
  let count = 0;
  for (let index = 3; index < image.pixels.length; index += 4) {
    if (image.pixels[index] === 255) {
      count += 1;
    }
  }
  return count;
};

describe('createCanvas', () => {
  it('is fully transparent', () => {
    const canvas = createCanvas(4, 3);

    expect(canvas).toMatchObject({ width: 4, height: 3 });
    expect(canvas.pixels).toHaveLength(48);
    expect(canvas.pixels.every((byte) => byte === 0)).toBe(true);
  });
});

describe('circle', () => {
  it('covers its centre fully, its outside not at all and its edge in between', () => {
    const shape = circle([10, 10], 5);

    expect(shape.coverage(10, 10)).toBe(1);
    expect(shape.coverage(10, 16.5)).toBe(0);
    expect(shape.coverage(10, 15)).toBe(0.5);
  });

  it('paints an anti-aliased disc of about pi r squared pixels', () => {
    const canvas = createCanvas(40, 40);

    paint(canvas, circle([20, 20], 10), red);

    expect(pixelAt(canvas, 20, 20)).toStrictEqual([255, 0, 0, 255]);
    expect(pixelAt(canvas, 0, 0)).toStrictEqual([0, 0, 0, 0]);
    const opaque = opaquePixelCount(canvas);
    expect(opaque).toBeGreaterThan(Math.PI * 9 * 9);
    expect(opaque).toBeLessThan(Math.PI * 10 * 10);
    const edgeAlpha = pixelAt(canvas, 20, 29)[3];
    expect(edgeAlpha).toBeGreaterThan(0);
    expect(edgeAlpha).toBeLessThan(255);
  });

  it('bounds the pixels it can touch', () => {
    expect(circle([10.5, 20.5], 3).bounds).toStrictEqual({
      left: 6,
      top: 16,
      right: 16,
      bottom: 26,
    });
  });
});

describe('ellipse', () => {
  it('is exact on its axes', () => {
    const shape = ellipse([50, 50], 20, 10);

    expect(shape.coverage(50, 50)).toBe(1);
    expect(shape.coverage(70, 50)).toBe(0.5);
    expect(shape.coverage(50, 60)).toBe(0.5);
    expect(shape.coverage(50, 61)).toBe(0);
    expect(shape.coverage(61, 50)).toBe(1);
  });
});

describe('triangle', () => {
  it('covers the inside whichever way the corners wind', () => {
    const clockwise = triangle([0, 0], [20, 0], [10, 20]);
    const counterClockwise = triangle([0, 0], [10, 20], [20, 0]);

    for (const shape of [clockwise, counterClockwise]) {
      expect(shape.coverage(10, 5)).toBe(1);
      expect(shape.coverage(10, 25)).toBe(0);
      expect(shape.coverage(1, 15)).toBe(0);
      expect(shape.coverage(10, 0)).toBe(0.5);
    }
  });

  it('paints about half of its bounding box', () => {
    const canvas = createCanvas(30, 30);

    paint(canvas, triangle([0, 0], [30, 0], [0, 30]), blue);

    const opaque = opaquePixelCount(canvas);
    expect(opaque).toBeGreaterThan(380);
    expect(opaque).toBeLessThan(450);
    expect(pixelAt(canvas, 2, 2)).toStrictEqual([0, 0, 255, 255]);
    expect(pixelAt(canvas, 28, 28)).toStrictEqual([0, 0, 0, 0]);
  });
});

describe('paint', () => {
  it('blends a translucent colour over an opaque one', () => {
    const canvas = createCanvas(1, 1);

    paint(canvas, circle([0.5, 0.5], 2), red);
    paint(canvas, circle([0.5, 0.5], 2), [0, 0, 255, 128]);

    expect(pixelAt(canvas, 0, 0)).toStrictEqual([127, 0, 128, 255]);
  });

  it('keeps the colour of a translucent stroke over a transparent canvas', () => {
    const canvas = createCanvas(1, 1);

    paint(canvas, circle([0.5, 0.5], 2), [0, 200, 0, 51]);

    expect(pixelAt(canvas, 0, 0)).toStrictEqual([0, 200, 0, 51]);
  });

  it('clips a shape that reaches over the edge of the canvas', () => {
    const canvas = createCanvas(4, 4);

    paint(canvas, circle([0, 0], 3), red);

    expect(pixelAt(canvas, 0, 0)).toStrictEqual([255, 0, 0, 255]);
    expect(pixelAt(canvas, 3, 3)).toStrictEqual([0, 0, 0, 0]);
  });
});
