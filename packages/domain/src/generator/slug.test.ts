import { describe, expect, it } from 'vitest';

import { generatedId, slugOf } from './slug.ts';

describe('slugOf', () => {
  it.each([
    ["Grandma Duck's Farm", 'grandma-ducks-farm'],
    ['Sir Quackington', 'sir-quackington'],
    ['  Della  Featherby ', 'della-featherby'],
    ['Quackmore Junior!', 'quackmore-junior'],
    ['Waddles the 3rd', 'waddles-the-3rd'],
  ] as [string, string][])('turns %j into %j', (name, slug) => {
    expect(slugOf(name)).toBe(slug);
  });
});

describe('generatedId', () => {
  it('appends the running number to the slug', () => {
    expect(generatedId("Featherby's Stables", 7)).toBe('featherbys-stables-7');
  });
});
