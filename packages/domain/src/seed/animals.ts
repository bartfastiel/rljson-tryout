import { hashed } from '../hashing.ts';
import {
  traitsRefsOf,
  type AnimalRow,
  type HashedAnimalRow,
} from '../tables/animals.ts';
import { breedersSeed } from './breeders.ts';
import { speciesSeed } from './species.ts';
import { traitsSeed } from './traits.ts';

/**
 * Looks up a seeded species by its `id` and returns its `_hash`, the value
 * an `animals` row needs in `speciesRef`. Throws when the id is unknown so a
 * typo in this file fails loudly instead of writing a dangling reference.
 */
const speciesRefFor = (speciesId: string): string => {
  const species = speciesSeed.find((row) => row.id === speciesId);
  if (species === undefined) {
    throw new Error(`No seeded species with id "${speciesId}".`);
  }
  return species._hash;
};

/**
 * Looks up a seeded breeder by its `id` and returns its `_hash`, the value
 * an `animals` row needs in `breederRef`. Throws when the id is unknown so a
 * typo in this file fails loudly instead of writing a dangling reference.
 */
const breederRefFor = (breederId: string): string => {
  const breeder = breedersSeed.find((row) => row.id === breederId);
  if (breeder === undefined) {
    throw new Error(`No seeded breeder with id "${breederId}".`);
  }
  return breeder._hash;
};

/**
 * Looks up seeded traits by their `id`s and returns their `_hash`es in the
 * canonical order of `traitsRefsOf`, the value an `animals` row needs in
 * `traitsRefs`. Throws when an id is unknown so a typo in this file fails
 * loudly instead of writing a dangling reference.
 */
const traitsRefsFor = (traitIds: readonly string[]): string[] =>
  traitsRefsOf(
    traitIds.map((traitId) => {
      const trait = traitsSeed.find((row) => row.id === traitId);
      if (trait === undefined) {
        throw new Error(`No seeded trait with id "${traitId}".`);
      }
      return trait;
    }),
  );

/**
 * Sir Quackington's background story, hand-written across several
 * paragraphs so that slice B4's long-content path (a value of several
 * thousand characters, split into paragraphs on blank lines by the web app)
 * is exercised by the seed itself rather than only by a synthetic test
 * fixture. Every other seeded animal gets a shorter story of roughly 600 to
 * 1 500 characters; see the bottom of this file.
 */
const sirQuackingtonStory = [
  "Sir Quackington did not ask for the title, and the shop has never found the paperwork that supposedly grants it, but he answers to nothing less, and after three decades of Duckburg pet shop history nobody has found it worth the argument. He remembers a much younger Scrooge McDuck personally counting the first million into the bin two streets over, back when the vault was barely taller than a duck standing on a stepladder, and he tells the story with the quiet satisfaction of someone who was, strictly speaking, not actually invited to watch but stood close enough to the fence that nobody thought to shoo him away. Whether any of that is true is beside the point; Sir Quackington has told it so many times, in so many convincing voices, that the shop's newer animals now repeat it to customers as established fact, and the older ones have simply stopped correcting him out of professional courtesy.",

  'His knighthood, such as it is, dates to the infamous night the Beagle Boys attempted what the local newspaper later called, generously, an ambitious withdrawal from Scrooge\'s bin using a plan involving a borrowed submarine, three ladders lashed together, and remarkably little forethought. Sir Quackington happened to be waddling past at the time, spotted the ladders wobbling against the vault wall, and did the only sensible thing available to a duck of his constitution: he quacked, loudly, continuously, and with a volume that woke half the block and every guard dog in it, including a considerably younger Bowser the Guard Dog several streets away, who arrived at a dead sprint with Nosey the Bloodhound close behind. The Beagle Boys were apprehended before the second ladder was even secured, and Sir Quackington has, ever since, referred to the incident simply as "the evening I did my civic duty", usually while accepting a second helping of bread as though it were a medal.',

  "Magica De Spell tried exactly once to relieve him of what she assumed was a lucky charm hidden somewhere in his famously immaculate feathers, having heard a wildly exaggerated rumour that a duck near the money bin carried a coin blessed by proximity to Scrooge's fortune. She found no coin, because there was no coin, only a very offended duck and a monocle that briefly turned an unflattering shade of green before returning to normal, a small side effect neither party has ever fully explained to the shop's satisfaction. Sir Quackington maintains that he saw through her disguise as a travelling feather merchant within the first ten seconds, on account of her boots, though the staff privately suspect he enjoys the story rather more than the memory. He warned young Daphne Duck about the whole affair not long after her own shimmering feathers arrived under similarly mysterious circumstances, and it is largely on his advice that she now wears the shimmer as pride rather than worry.",

  'Grandma Duck, whom Sir Quackington insists on calling an old family friend despite a complete absence of shared family, once fostered him for a summer on her farm after a flood closed the shop for repairs, and he returned with opinions. Strong opinions, mostly about pie, about the correct way to line a nest, and about the general superiority of farm mornings over city ones, opinions he shares at length and without much prompting to anyone who will sit still for it, which these days is mainly Pepper the Poodle and Henrietta the Egg Champion, both farm veterans themselves and both, unlike the ducklings, patient enough to let him finish a sentence. He still keeps, tucked under a corner of his enclosure, a single pressed clover from that summer, and refuses to say why, which everyone agrees is the most sentimental thing about him and the one subject on which he will absolutely not elaborate.',

  "Gyro Gearloose once built him a walking cane fitted with what the inventor described as seventeen entirely practical features, including a retractable umbrella, a small compass, and a bell tuned to what Gyro swore was a historically accurate pitch for announcing a knight's arrival. Sir Quackington uses exactly one of the seventeen features, the bell, and only when he wants tea, a fact that has not stopped him from describing the cane to every visiting customer as an heirloom of considerable engineering pedigree. Gadget the Inventor and Clara Cluck Junior, Gyro's two most devoted junior admirers in the shop, have each separately offered to service the cane's remaining sixteen features free of charge, and Sir Quackington has each time declined with great ceremony, on the grounds that a knight's tools are not to be improved upon, only maintained, a distinction he considers self-evident and nobody has yet successfully argued him out of.",

  "He has appointed himself, entirely without a vote, mentor to every duckling that has passed through the shop in the last several years, a role he takes with the seriousness of a man who believes manners are the only inheritance worth leaving behind. Quackmore Junior gets lectures on the difference between confidence and volume, which Quackmore absorbs by immediately getting louder. Donald the Third gets lectures on the sailor cap, which Sir Quackington considers borrowed finery worn without sufficient understanding of its history, though he has never specified whose history he means. Daphne Duck gets the gentlest treatment of all, mostly compliments disguised as advice, because Sir Quackington has decided, privately and somewhat sentimentally, that she reminds him of somebody he is no longer willing to name, and the shop's staff have learned not to ask.",

  "His daily routine is fixed with the precision of a small ceremony: a slow circuit of the enclosure at sunrise, a firm inspection of the water dish, a period of sitting very still while pretending not to watch the door for customers he might approve of, and an afternoon nap he insists is strategic thinking. He has turned down at least four adoption offers over the years, each time for a reason so specific and so confidently delivered that the staff simply update the file and move on: the light in that home was insufficient for a duck of his complexion, the family in question had not yet demonstrated sufficient seriousness of character, and, on one memorable occasion, the prospective owner's handshake was, in his professional opinion, not to be trusted.",

  "The shop's manager long ago stopped listing Sir Quackington's price as anything but aspirational, since nobody expects the highest tag in the shop to actually change hands, least of all the duck wearing it. He is, everyone quietly agrees, less an animal for sale than a fixture of the place, somewhere between a mascot and a minor local legend, and the newer animals learn his stories within their first week whether they ask for them or not. Ask him directly whether he minds staying, and he will draw himself up to his full, modest height, adjust a monocle that has never once needed adjusting, and explain, at some length, that a knight does not leave his post simply because nobody has formally relieved him of it, a sentiment the shop has, by now, simply stopped arguing with.",
].join('\n\n');

const animalRows: readonly AnimalRow[] = [
  {
    id: 'quackmore-junior',
    name: 'Quackmore Junior',
    speciesRef: speciesRefFor('duck'),
    breederRef: breederRefFor('daisys-duckling-nursery'),
    bornOn: '2022-03-14',
    priceCents: 45000,
    backgroundStory:
      "Quackmore Junior was hatched two coops down from Scrooge McDuck's money bin, and the clang of falling dimes was the first sound he ever heard, which the family insists explains his lifelong talent for landing on his feet with a loud metallic thud. He spent his egg money, all four cents of it, on a magnifying glass, convinced that with enough patience he could find one coin Scrooge had personally misplaced and earn a finder's fee. He never found it, but he did find Donald the Third asleep in the money bin's shadow during a game of hide and seek, and the two have been swimming rivals ever since, each insisting he can dive to the bottom of the bin faster than the other, a race neither has ever actually been permitted to attempt. Quackmore now keeps his own savings in a jam jar under a loose floorboard, which he considers a modest but entirely dignified homage.",
    traitsRefs: traitsRefsFor(['hoards-shiny-objects', 'competitive-streak']),
  },
  {
    id: 'donald-the-third',
    name: 'Donald the Third',
    speciesRef: speciesRefFor('duck'),
    breederRef: breederRefFor('daisys-duckling-nursery'),
    bornOn: '2023-06-01',
    priceCents: 52000,
    backgroundStory:
      "Donald the Third is named, with a perfectly straight face, after a duck none of his breeders can definitively prove is related to the famous sailor-suited Donald Duck of downtown Duckburg, though the resemblance in temper is uncanny. He inherited a single, ancient sailor cap from an aunt who swore it was authentic, and he wears it only on days when he feels lucky, which the shop's staff have learned to read as an early storm warning. His finest hour came during a swimming race against Quackmore Junior through the storm drains behind the money bin, a contest that ended in a tie only because both ducks got equally and thoroughly stuck in the same grate. He is, by his own account, undefeated, and by everyone else's account, still stuck rather often.",
    traitsRefs: traitsRefsFor(['chronically-unlucky', 'competitive-streak']),
  },
  {
    id: 'daphne-duck',
    name: 'Daphne Duck',
    speciesRef: speciesRefFor('duck'),
    breederRef: breederRefFor('daisys-duckling-nursery'),
    bornOn: '2021-11-09',
    priceCents: 38000,
    backgroundStory:
      "Daphne Duck arrived at the shop with a faint shimmer to her feathers that the previous owner blamed, not entirely jokingly, on a beauty spell gone slightly wrong at the hands of Magica De Spell, who was reportedly aiming for someone else's plumage entirely and hit the wrong pond by a considerable margin. Daphne has decided to treat the shimmer as a fashion statement rather than a curse, and struts around her enclosure as though she personally invented the concept of glamour. She takes her deportment lessons seriously, mostly because Sir Quackington, the shop's resident elder statesman, once told her that a duck with good posture can get away with almost anything, and she has not stopped standing up straight since that afternoon.",
    traitsRefs: traitsRefsFor(['surprisingly-well-mannered']),
  },
  {
    id: 'sir-quackington',
    name: 'Sir Quackington',
    speciesRef: speciesRefFor('duck'),
    breederRef: breederRefFor('daisys-duckling-nursery'),
    bornOn: '2019-08-08',
    priceCents: 68000,
    backgroundStory: sirQuackingtonStory,
    traitsRefs: traitsRefsFor([
      'surprisingly-well-mannered',
      'quietly-sentimental',
      'fiercely-loyal',
      'keen-senses',
    ]),
  },
  {
    id: 'bowser-the-guard-dog',
    name: 'Bowser the Guard Dog',
    speciesRef: speciesRefFor('dog'),
    breederRef: breederRefFor('rockerduck-kennels'),
    bornOn: '2020-07-22',
    priceCents: 61000,
    backgroundStory:
      "Bowser the Guard Dog takes his job title extremely literally, which is mildly inconvenient for a pet shop that mostly needs someone to greet customers rather than repel intruders. He earned his reputation the night three suspiciously identical dogs in matching striped shirts tried to tunnel in through the back wall, and Bowser simply sat on the hole until Duckburg's finest arrived, refusing to move even for treats, which the staff still bring up at every opportunity. The shop's paperwork lists the culprits only as persons of interest, though everyone quietly agrees the Beagle Boys have never before been foiled by a dog who declined, with great dignity, to get up. Off duty, Bowser is inseparable from Nosey the Bloodhound, his self-appointed partner in a two-dog patrol neither of them was ever formally assigned.",
    traitsRefs: traitsRefsFor(['fiercely-loyal', 'keen-senses']),
  },
  {
    id: 'nosey-the-bloodhound',
    name: 'Nosey the Bloodhound',
    speciesRef: speciesRefFor('dog'),
    breederRef: breederRefFor('rockerduck-kennels'),
    bornOn: '2022-01-30',
    priceCents: 47000,
    backgroundStory:
      'Nosey the Bloodhound can smell a lie at forty paces and a sandwich at four hundred, a combination of talents that makes him equally useful for security and for staff morale. Gyro Gearloose once tried to build him a mechanical nose attachment that promised to double his tracking range, but Nosey sneezed so hard during the fitting that the device flew clean across the workshop and has not been seen since, which the inventor now quietly lists among his more forgettable prototypes. He patrols the shop each evening alongside Bowser the Guard Dog, the two of them taking their unofficial partnership more seriously than most professionals take an actual job, and woe to any Beagle Boy who forgets that a bloodhound never really forgets a scent, no matter how many years go by.',
    traitsRefs: traitsRefsFor(['keen-senses', 'fiercely-loyal']),
  },
  {
    id: 'pepper-the-poodle',
    name: 'Pepper the Poodle',
    speciesRef: speciesRefFor('dog'),
    breederRef: breederRefFor('grandma-ducks-farm'),
    bornOn: '2023-09-05',
    priceCents: 55000,
    backgroundStory:
      "Pepper the Poodle spent her first months on Grandma Duck's farm, where she developed a lifelong conviction that every problem can be solved with a fresh-baked pie and a firm talking-to, an outlook the shop's other animals find either soothing or faintly alarming depending on the day. She insists on grooming herself to competition standard even though no competition has ever actually been announced, and treats every customer visit as an audition for a title only she believes exists. Her closest friend in the shop is Henrietta the Egg Champion, whom she met over a disputed batch of farm-fresh eggs and has considered a kindred spirit ever since, mostly because Henrietta is the only other animal willing to discuss ribbon placements at any length whatsoever.",
    traitsRefs: traitsRefsFor(['competitive-streak']),
  },
  {
    id: 'clara-cluck-junior',
    name: 'Clara Cluck Junior',
    speciesRef: speciesRefFor('chicken'),
    breederRef: breederRefFor('gearloose-workshop-hatchery'),
    bornOn: '2021-04-18',
    priceCents: 21000,
    backgroundStory:
      "Clara Cluck Junior grew up underfoot in Gyro Gearloose's workshop, which explains both her fearless attitude toward loud noises and her habit of rearranging spare parts into what she insists are sculptures rather than, as the inventor claims, an inventory nightmare in progress. She once assembled a fully functional if slightly wobbly alarm clock out of gears nobody remembers ordering, and gave it as a birthday present to her cousin Gadget the Inventor, who has not stopped setting it three minutes fast out of sheer professional pride ever since. Clara maintains that her masterpiece is still ahead of her, waiting for whenever the workshop next runs out of things to tidy, and the shop's staff have long since learned to simply let her keep tidying in peace.",
    traitsRefs: traitsRefsFor(['inventive', 'hoards-shiny-objects']),
  },
  {
    id: 'gadget-the-inventor',
    name: 'Gadget the Inventor',
    speciesRef: speciesRefFor('chicken'),
    breederRef: breederRefFor('gearloose-workshop-hatchery'),
    bornOn: '2022-12-02',
    priceCents: 27500,
    backgroundStory:
      "Gadget the Inventor is, by unanimous and slightly exhausted staff agreement, the closest thing the shop has to a junior Gyro Gearloose, right down to the habit of thinking out loud in half-finished sentences while dismantling whatever happens to be nearest. Her proudest invention to date is a perch that adjusts its own height, built from parts she borrowed, with every intention of returning them, from her cousin Clara Cluck Junior's toy box. It still squeaks on humid days, a flaw Gadget insists is a feature that usefully reminds everyone of the weather. She keeps a growing folder of blueprints for a shop-wide automatic feeder, which the manager has so far diplomatically filed under someday, mostly out of fond memory of what happened the last time a Gearloose contraption got anywhere near the food supply.",
    traitsRefs: traitsRefsFor(['inventive', 'hoards-shiny-objects']),
  },
  {
    id: 'henrietta-the-egg-champion',
    name: 'Henrietta the Egg Champion',
    speciesRef: speciesRefFor('chicken'),
    breederRef: breederRefFor('grandma-ducks-farm'),
    bornOn: '2020-05-14',
    priceCents: 19500,
    backgroundStory:
      "Henrietta the Egg Champion holds three consecutive ribbons from Grandma Duck's annual farm fair, a fact she mentions within the first minute of meeting anyone, feathered or otherwise. Her eggs are, by every honest account, genuinely exceptional, laid with a ceremony that suggests she considers each one a small masterpiece rather than breakfast. She trains for the fair year round with an intensity that has occasionally worried the shop's manager, including one memorable incident involving a nest built entirely to regulation blueprint specifications borrowed, without a great deal of permission, from Gadget the Inventor. Her closest companion is Pepper the Poodle, whom Henrietta has long since recruited as an unofficial judge for practice rounds, a role Pepper accepts with the gravity of someone convinced she is finally getting the recognition she deserves.",
    traitsRefs: traitsRefsFor(['competitive-streak']),
  },
];

/**
 * Ten Duckburg pets every node starts with, each referencing one of the
 * three seeded species by its `_hash`, one of the four seeded breeders by
 * its `_hash` (chosen to fit the animal's own `backgroundStory`, see
 * `breedersSeed`) and one to four of the eight seeded traits by their
 * `_hash`es, chosen to be consistent with the animal's own `backgroundStory`
 * (Quackmore Junior's jam-jar savings and swimming rivalry give him "hoards
 * shiny objects" and "has a competitive streak"; Sir Quackington's
 * mentoring, keepsake and vigilance give him all four of "surprisingly
 * well-mannered", "quietly sentimental", "fiercely loyal" and "keen senses";
 * and so on for the rest). Every animal's `backgroundStory`
 * cross-references at least one Duckburg regular
 * (Scrooge McDuck, Donald Duck, Gyro Gearloose, the Beagle Boys, Magica De
 * Spell or Grandma Duck) and at least one other seeded animal; Sir
 * Quackington's story is the hand-written multi-paragraph outlier of
 * several thousand characters that exercises slice B4's long-content path.
 * The rows are hashed here so that every node computes the same `_hash` for
 * the same content, matching the pattern of `speciesSeed`.
 */
export const animalsSeed: readonly HashedAnimalRow[] = animalRows.map((row) =>
  hashed(row),
);
