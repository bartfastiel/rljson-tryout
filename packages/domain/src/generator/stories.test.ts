import { describe, expect, it } from 'vitest';

import { duckburgRegulars } from './namePools.ts';
import { createRandomSource } from './randomSource.ts';
import { generateStory, storyLength, type StoryFacts } from './stories.ts';

const facts: StoryFacts = {
  name: 'Waddles the Bold',
  speciesName: 'Goose',
  traits: [
    {
      name: 'Escape artist',
      description:
        'No latch, lid or fence has held this one for longer than an afternoon.',
    },
    {
      name: 'Night owl',
      description:
        'Comes alive after dark and treats every sunrise as a personal inconvenience.',
    },
  ],
  farmName: 'Featherby Stables',
  breederPersonName: 'Della Featherby',
};

describe('generateStory', () => {
  it('names the animal, its species, one of its traits, the farm and the breeder', () => {
    const story = generateStory(facts, createRandomSource('story'));

    expect(story).toContain('Waddles the Bold');
    expect(story).toContain('goose');
    expect(story).toContain('Featherby Stables');
    expect(story).toContain('Della Featherby');
    expect(
      facts.traits.some((trait) => story.includes(`"${trait.name}"`)),
    ).toBe(true);
    expect(duckburgRegulars.some((regular) => story.includes(regular))).toBe(
      true,
    );
  });

  it('stays within the length bounds for every combination of its templates', () => {
    const random = createRandomSource('lengths');

    for (let round = 0; round < 500; round += 1) {
      const story = generateStory(facts, random);
      expect(story.length).toBeGreaterThanOrEqual(storyLength.minimum);
      expect(story.length).toBeLessThanOrEqual(storyLength.maximum);
    }
  });

  it('is deterministic for the same facts and random source', () => {
    expect(generateStory(facts, createRandomSource('same'))).toBe(
      generateStory(facts, createRandomSource('same')),
    );
  });

  it('refuses facts without a trait, since every story names one', () => {
    expect(() =>
      generateStory({ ...facts, traits: [] }, createRandomSource('none')),
    ).toThrow(RangeError);
  });
});
