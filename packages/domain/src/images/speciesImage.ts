import { hshBuffer } from '@rljson/hash';

import {
  createRandomSource,
  type RandomSource,
} from '../generator/randomSource.ts';
import { encodePng } from './png.ts';
import {
  circle,
  createCanvas,
  ellipse,
  paint,
  triangle,
  type Point,
  type Rgba,
  type Shape,
} from './raster.ts';

/** The media type of every species image, what `species.imageMimeType` holds. */
export const speciesImageMimeType = 'image/png';

/** Species images are square; this is their side in pixels. */
export const speciesImageSize = 256;

/**
 * The colour pairs a species badge is painted in: the badge itself in the
 * first, the face in the second. Chosen by hand so that every pair reads
 * as intentional on the shop's cards in light and dark mode alike, and
 * picked per species from the seeded random source below.
 */
const palettes: readonly (readonly [badge: Rgba, face: Rgba])[] = [
  [
    [42, 157, 143, 255],
    [247, 238, 222, 255],
  ],
  [
    [192, 96, 58, 255],
    [250, 229, 205, 255],
  ],
  [
    [123, 75, 148, 255],
    [243, 224, 236, 255],
  ],
  [
    [58, 125, 68, 255],
    [226, 242, 228, 255],
  ],
  [
    [43, 76, 126, 255],
    [222, 233, 247, 255],
  ],
  [
    [201, 154, 46, 255],
    [252, 243, 216, 255],
  ],
  [
    [192, 76, 106, 255],
    [251, 227, 234, 255],
  ],
  [
    [75, 93, 107, 255],
    [232, 238, 242, 255],
  ],
  [
    [122, 138, 58, 255],
    [241, 243, 219, 255],
  ],
  [
    [224, 107, 77, 255],
    [253, 230, 218, 255],
  ],
  [
    [31, 111, 139, 255],
    [220, 240, 246, 255],
  ],
  [
    [107, 74, 55, 255],
    [241, 228, 217, 255],
  ],
];

const ink: Rgba = [36, 36, 42, 255];
const highlight: Rgba = [255, 255, 255, 255];
const beak: Rgba = [242, 164, 68, 255];

const earStyles = ['round', 'pointed', 'floppy', 'none'] as const;
const faceStyles = ['beak', 'nose', 'snout'] as const;

type EarStyle = (typeof earStyles)[number];
type FaceStyle = (typeof faceStyles)[number];

/**
 * The features one badge is drawn from, all drawn from the random source
 * in this fixed order, so that a species id maps to the same badge on
 * every node and for as long as this order stands.
 */
type Badge = {
  badgeColour: Rgba;
  faceColour: Rgba;
  earStyle: EarStyle;
  faceStyle: FaceStyle;
  headRadius: number;
  eyeDistance: number;
  eyeHeight: number;
};

const drawBadge = (random: RandomSource): Badge => {
  const [badgeColour, faceColour] = random.pick(palettes);
  return {
    badgeColour,
    faceColour,
    earStyle: random.pick(earStyles),
    faceStyle: random.pick(faceStyles),
    headRadius: random.integerBetween(54, 66),
    eyeDistance: random.integerBetween(18, 26),
    eyeHeight: random.integerBetween(-4, 4),
  };
};

const center = speciesImageSize / 2;
const headCenterY = center + 8;

/** The badge colour at a fraction of its alpha: inner ears, cheeks, snout. */
const tinted = ([red, green, blue]: Rgba, alpha: number): Rgba => [
  red,
  green,
  blue,
  alpha,
];

const mirrored = (
  shapeAt: (x: number) => Shape,
  offset: number,
): [Shape, Shape] => [shapeAt(center - offset), shapeAt(center + offset)];

/**
 * The ears, drawn before the head so that the head overlaps their base:
 * each style as a pair of outer shapes in the face colour and inner
 * shapes in a tint of the badge colour.
 */
const earShapes = (
  badge: Badge,
): { outer: readonly Shape[]; inner: readonly Shape[] } => {
  const { headRadius, earStyle } = badge;
  const top = headCenterY - headRadius;
  switch (earStyle) {
    case 'round': {
      const spread = headRadius - 10;
      return {
        outer: mirrored((x) => circle([x, top + 12], 22), spread),
        inner: mirrored((x) => circle([x, top + 12], 12), spread),
      };
    }
    case 'pointed': {
      const spread = headRadius - 22;
      const pointed = (x: number, halfWidth: number, height: number): Shape =>
        triangle(
          [x - halfWidth, top + 26],
          [x + halfWidth, top + 26],
          [x, top + 26 - height],
        );
      return {
        outer: mirrored((x) => pointed(x, 22, 46), spread),
        inner: mirrored((x) => pointed(x, 11, 28), spread),
      };
    }
    case 'floppy': {
      const spread = headRadius + 2;
      return {
        outer: mirrored((x) => ellipse([x, headCenterY + 6], 17, 40), spread),
        inner: mirrored((x) => ellipse([x, headCenterY + 10], 8, 26), spread),
      };
    }
    case 'none':
      return { outer: [], inner: [] };
  }
};

/**
 * The lower face: a beak, a nose, or a snout with a nose on it.
 */
const faceShapes = (badge: Badge): readonly (readonly [Shape, Rgba])[] => {
  const mouthY = headCenterY + 14;
  switch (badge.faceStyle) {
    case 'beak':
      return [
        [
          triangle(
            [center - 15, mouthY - 4],
            [center + 15, mouthY - 4],
            [center, mouthY + 20],
          ),
          beak,
        ],
      ];
    case 'nose':
      return [[ellipse([center, mouthY], 9, 6), ink]];
    case 'snout':
      return [
        [ellipse([center, mouthY + 6], 22, 15), tinted(badge.badgeColour, 70)],
        [ellipse([center, mouthY], 8, 5), ink],
      ];
  }
};

/**
 * The image of one species: a round badge with a friendly creature face
 * whose colours, ears, snout and proportions are drawn from the species id
 * through the seed generator's random source, so that the same id gives
 * byte-for-byte the same PNG on every node (`docs/findings/blobs.md`) and
 * two species look recognisably different. A stylised motif rather than a
 * likeness: slice F1 draws the real illustrations.
 */
export const speciesImage = (speciesId: string): Uint8Array => {
  const badge = drawBadge(createRandomSource(`species-image:${speciesId}`));
  const canvas = createCanvas(speciesImageSize, speciesImageSize);
  const head: Point = [center, headCenterY];
  const eyeY = headCenterY - 10 + badge.eyeHeight;
  const ears = earShapes(badge);

  paint(canvas, circle([center, center], center - 6), badge.badgeColour);
  for (const ear of ears.outer) {
    paint(canvas, ear, badge.faceColour);
  }
  for (const ear of ears.inner) {
    paint(canvas, ear, tinted(badge.badgeColour, 110));
  }
  paint(canvas, circle(head, badge.headRadius), badge.faceColour);
  for (const cheek of mirrored(
    (x) => circle([x, eyeY + 22], 9),
    badge.headRadius - 18,
  )) {
    paint(canvas, cheek, tinted(badge.badgeColour, 60));
  }
  for (const eye of mirrored((x) => circle([x, eyeY], 6), badge.eyeDistance)) {
    paint(canvas, eye, ink);
  }
  for (const glint of mirrored(
    (x) => circle([x + 2, eyeY - 2], 2),
    badge.eyeDistance,
  )) {
    paint(canvas, glint, highlight);
  }
  for (const [shape, colour] of faceShapes(badge)) {
    paint(canvas, shape, colour);
  }

  return encodePng(canvas);
};

/**
 * The id under which a `Bs` of `@rljson/bs` stores the image of this
 * species: the content hash it computes itself in `setBlob`, the
 * 22-character base64url prefix of the SHA-256 of the PNG bytes, which the
 * seed writes into `species.imageBlobId` before any blob store has seen
 * the image.
 */
export const speciesImageBlobId = (speciesId: string): string =>
  hshBuffer(speciesImage(speciesId));
