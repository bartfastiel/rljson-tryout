import { hashed } from '../hashing.ts';
import type { HashedTraitRow, TraitRow } from '../tables/traits.ts';

const traitRows: readonly TraitRow[] = [
  {
    id: 'hoards-shiny-objects',
    name: 'Hoards shiny objects',
    description:
      'Keeps a private stash of coins, gears or anything else that glints, ' +
      'and guards it with quiet suspicion.',
  },
  {
    id: 'chronically-unlucky',
    name: 'Chronically unlucky',
    description:
      'Slapstick seems to follow this one around; the timing is never on ' +
      'their side.',
  },
  {
    id: 'inventive',
    name: 'Inventive',
    description:
      'Turns spare parts and loose gears into something that almost ' +
      'always works.',
  },
  {
    id: 'escapes-any-enclosure',
    name: 'Escapes any enclosure',
    description:
      'No pen, fence or storm drain grate has ever proven entirely secure.',
  },
  {
    id: 'fiercely-loyal',
    name: 'Fiercely loyal',
    description:
      'Shows up first and leaves last for anyone they have decided to look ' +
      'after.',
  },
  {
    id: 'keen-senses',
    name: 'Keen senses',
    description:
      'Notices the sandwich, the lie and the stranger long before anyone ' +
      'else does.',
  },
  {
    id: 'competitive-streak',
    name: 'Has a competitive streak',
    description:
      'Turns almost anything, judged or not, into a contest worth winning.',
  },
  {
    id: 'surprisingly-well-mannered',
    name: 'Surprisingly well-mannered',
    description:
      'Minds their posture, their manners and their word, even when nobody ' +
      'is watching.',
  },
  {
    id: 'quietly-sentimental',
    name: 'Quietly sentimental',
    description: 'Keeps one small memento nobody is allowed to ask about.',
  },
];

/**
 * The nine Duckburg-flavoured traits every node starts with. The rows are
 * hashed here so that every node computes the same `_hash` for the same
 * content, matching the pattern of `speciesSeed`.
 */
export const traitsSeed: readonly HashedTraitRow[] = traitRows.map((row) =>
  hashed(row),
);
