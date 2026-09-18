import type { RgbaImage } from './png.ts';

/**
 * A colour as the rasterizer paints it: red, green, blue and alpha, each
 * 0 to 255, alpha not premultiplied.
 */
export type Rgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

/** A point in pixel coordinates; a pixel's centre sits at `.5`. */
export type Point = readonly [x: number, y: number];

/**
 * A filled shape as `paint` consumes it: the pixel box it can touch (left
 * and top inclusive, right and bottom exclusive) and, for a point, how much
 * of a pixel centred there it covers, from 0 outside to 1 inside, with the
 * one-pixel band along its edge in between. That band is the
 * anti-aliasing: a pixel the edge crosses is painted with a matching
 * partial alpha, so a circle upscaled on a phone screen stays smooth.
 */
export type Shape = Readonly<{
  bounds: Readonly<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>;
  coverage: (x: number, y: number) => number;
}>;

/**
 * A fully transparent image of the given size for `paint` to draw into.
 */
export const createCanvas = (width: number, height: number): RgbaImage => ({
  width,
  height,
  pixels: new Uint8Array(width * height * 4),
});

/**
 * Coverage from a signed distance to a shape's edge (negative inside):
 * full within half a pixel inside, none beyond half a pixel outside, a
 * linear ramp in between.
 *
 * Every distance below is computed with additions, multiplications and
 * `Math.sqrt` only, whose results IEEE 754 fixes to the bit; `Math.hypot`,
 * `Math.pow` and the trigonometric functions are left out on purpose,
 * since their rounding may differ between JavaScript engines, and an
 * image that differs by one pixel has another blob id on another node.
 */
const coverageOfDistance = (distance: number): number =>
  Math.min(1, Math.max(0, 0.5 - distance));

const boundsAround = (
  points: readonly Point[],
  margin: number,
): Shape['bounds'] => {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return {
    left: Math.floor(left - margin),
    top: Math.floor(top - margin),
    right: Math.ceil(right + margin) + 1,
    bottom: Math.ceil(bottom + margin) + 1,
  };
};

/**
 * A filled circle.
 */
export const circle = ([centerX, centerY]: Point, radius: number): Shape => ({
  bounds: boundsAround([[centerX, centerY]], radius + 1),
  coverage: (x, y) => {
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    return coverageOfDistance(
      Math.sqrt(deltaX * deltaX + deltaY * deltaY) - radius,
    );
  },
});

/**
 * A filled axis-aligned ellipse. The distance to its edge is approximated
 * by scaling the circle distance with the smaller radius, exact on the
 * axes and close enough elsewhere for a one-pixel edge band.
 */
export const ellipse = (
  [centerX, centerY]: Point,
  radiusX: number,
  radiusY: number,
): Shape => ({
  bounds: boundsAround([[centerX, centerY]], Math.max(radiusX, radiusY) + 1),
  coverage: (x, y) => {
    const scaledX = (x - centerX) / radiusX;
    const scaledY = (y - centerY) / radiusY;
    return coverageOfDistance(
      (Math.sqrt(scaledX * scaledX + scaledY * scaledY) - 1) *
        Math.min(radiusX, radiusY),
    );
  },
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The squared distance from a point to the segment `from` to `to`, and on
 * which side of the segment the point lies (the sign of the cross
 * product), what the triangle distance below is assembled from.
 */
const segmentDistance = (
  point: Point,
  from: Point,
  to: Point,
): { squaredDistance: number; side: number } => {
  const edgeX = to[0] - from[0];
  const edgeY = to[1] - from[1];
  const offsetX = point[0] - from[0];
  const offsetY = point[1] - from[1];
  const along = clamp01(
    (offsetX * edgeX + offsetY * edgeY) / (edgeX * edgeX + edgeY * edgeY),
  );
  const nearestX = offsetX - edgeX * along;
  const nearestY = offsetY - edgeY * along;
  return {
    squaredDistance: nearestX * nearestX + nearestY * nearestY,
    side: offsetX * edgeY - offsetY * edgeX,
  };
};

/**
 * A filled triangle with the given corners, in either winding order. The
 * exact signed distance: the distance to the nearest edge, negative when
 * the point lies on the inner side of all three edges.
 */
export const triangle = (a: Point, b: Point, c: Point): Shape => {
  const winding = Math.sign(
    (b[0] - a[0]) * (a[1] - c[1]) - (b[1] - a[1]) * (a[0] - c[0]),
  );
  return {
    bounds: boundsAround([a, b, c], 1),
    coverage: (x, y) => {
      const point: Point = [x, y];
      const edges = [
        segmentDistance(point, a, b),
        segmentDistance(point, b, c),
        segmentDistance(point, c, a),
      ];
      const squaredDistance = Math.min(
        ...edges.map((edge) => edge.squaredDistance),
      );
      const innermostSide = Math.min(
        ...edges.map((edge) => winding * edge.side),
      );
      const inside = innermostSide > 0;
      return coverageOfDistance((inside ? -1 : 1) * Math.sqrt(squaredDistance));
    },
  };
};

/**
 * Paints a shape onto the canvas in the given colour, blending it over
 * whatever is there ("source over"), with the shape's coverage scaling the
 * colour's alpha along its edge.
 */
export const paint = (canvas: RgbaImage, shape: Shape, colour: Rgba): void => {
  const { bounds } = shape;
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const right = Math.min(canvas.width, bounds.right);
  const bottom = Math.min(canvas.height, bounds.bottom);
  const [red, green, blue, alpha] = colour;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const coverage = shape.coverage(x + 0.5, y + 0.5);
      if (coverage <= 0) {
        continue;
      }
      const index = (y * canvas.width + x) * 4;
      const sourceAlpha = (coverage * alpha) / 255;
      const targetAlpha = canvas.pixels[index + 3] / 255;
      const targetWeight = targetAlpha * (1 - sourceAlpha);
      const outAlpha = sourceAlpha + targetWeight;
      const blend = (source: number, target: number): number =>
        Math.round((source * sourceAlpha + target * targetWeight) / outAlpha);
      canvas.pixels[index] = blend(red, canvas.pixels[index]);
      canvas.pixels[index + 1] = blend(green, canvas.pixels[index + 1]);
      canvas.pixels[index + 2] = blend(blue, canvas.pixels[index + 2]);
      canvas.pixels[index + 3] = Math.round(outAlpha * 255);
    }
  }
};
