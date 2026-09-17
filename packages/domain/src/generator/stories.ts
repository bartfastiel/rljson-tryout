import { duckburgRegulars } from './namePools.ts';
import type { RandomSource } from './randomSource.ts';

/**
 * What a generated story is written from: the animal's name, its species,
 * the traits it carries (at least one), and the farm and person it came
 * from. Every story mentions the name, the species, one trait by name and
 * the farm, so that the facts block of the detail view and the story never
 * contradict each other; slice B11 replaces these short stories with the
 * long arcs.
 */
export type StoryFacts = {
  name: string;
  speciesName: string;
  traits: readonly { name: string; description: string }[];
  farmName: string;
  breederPersonName: string;
};

type StoryContext = StoryFacts & {
  species: string;
  person: string;
};

type Sentence = (context: StoryContext) => string;

const lowerFirst = (text: string): string =>
  text.charAt(0).toLowerCase() + text.slice(1);

const openings: readonly Sentence[] = [
  ({ name, species, farmName, person }) =>
    `${name} is a ${species} from ${farmName}, where ${person} has kept animals for longer than anyone in Duckburg cares to remember.`,
  ({ name, species, farmName, person }) =>
    `${name} came to the shop from ${farmName} on a rainy Tuesday, and ${person} still asks after the ${species} every time an order goes out.`,
  ({ name, species, farmName, person }) =>
    `Of every ${species} ${person} has sent to town from ${farmName}, ${name} is the one the neighbours still talk about.`,
  ({ name, species, farmName, person }) =>
    `${name} hatched, or was born, or simply appeared one morning at ${farmName}; ${person} has never settled the question, and the ${species} is not telling.`,
];

const traitSentences: readonly ((
  context: StoryContext,
  trait: { name: string; description: string },
) => string)[] = [
  ({ name }, trait) =>
    `The shop's ledger lists ${name} under "${trait.name}", and the note beside it reads: ${lowerFirst(trait.description)}`,
  ({ name }, trait) =>
    `Everyone who has looked after ${name} agrees on the trait that matters, "${trait.name}": ${lowerFirst(trait.description)}`,
  ({ name, farmName, person }, trait) =>
    `${person} warned the shop about one thing, "${trait.name}", before ${name} left ${farmName}: ${lowerFirst(trait.description)}`,
];

const anecdotes: readonly ((
  context: StoryContext,
  regular: string,
) => string)[] = [
  ({ name }, regular) =>
    `${regular} once stopped by the shop, took one look at ${name} and left with a story nobody has been able to confirm since.`,
  ({ name, species }, regular) =>
    `There is a rumour that ${regular} tried to buy ${name} outright, and that the ${species} turned the offer down.`,
  ({ name, species }, regular) =>
    `On the afternoon ${regular} visited, ${name} did exactly what a ${species} should not, and the shop has kept the photograph.`,
  ({ name, species }, regular) =>
    `${name} has met ${regular} twice, and both times the ${species} came out of it looking the more sensible of the two.`,
  ({ name, species }, regular) =>
    `When ${regular} needed a ${species} for reasons never explained, it was ${name} the shop nearly sent, and ${name} the shop kept.`,
];

const closings: readonly Sentence[] = [
  ({ name, farmName, person }) =>
    `These days ${name} waits by the shop window, and ${person} of ${farmName} is welcome to visit, which is more than most breeders can say.`,
  ({ species, farmName, person }) =>
    `The price on the tag is fair, ${person} says, for a ${species} of this character, and ${farmName} stands behind every animal it sends.`,
  ({ name, farmName, person }) =>
    `Whoever takes ${name} home should know that ${farmName} expects a postcard, and ${person} reads every one aloud.`,
];

/**
 * The shortest and longest story `generateStory` produces. The four
 * sentences of a story add up to more than the minimum for every
 * combination of pools, and to less than the maximum for every combination
 * of the longest names, so no story is ever padded or cut; the test over
 * the large seed proves the bounds hold for every generated animal.
 */
export const storyLength = { minimum: 300, maximum: 800 } as const;

/**
 * A short template-based background story of four sentences: where the
 * animal came from, the trait that describes it best, an encounter with a
 * Duckburg regular, and how the breeder feels about it. Deterministic for
 * the given facts and random source.
 */
export const generateStory = (
  facts: StoryFacts,
  random: RandomSource,
): string => {
  if (facts.traits.length === 0) {
    throw new RangeError('A story needs at least one trait to mention.');
  }
  const context: StoryContext = {
    ...facts,
    species: facts.speciesName.toLowerCase(),
    person: facts.breederPersonName,
  };
  const trait = random.pick(facts.traits);
  const regular = random.pick(duckburgRegulars);

  return [
    random.pick(openings)(context),
    random.pick(traitSentences)(context, trait),
    random.pick(anecdotes)(context, regular),
    random.pick(closings)(context),
  ].join(' ');
};
