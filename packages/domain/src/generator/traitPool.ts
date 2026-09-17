/**
 * One trait the generator can add to the catalogue, in the shape of the
 * hand-written traits of `traitsSeed`: a short name and one sentence of
 * description. A size takes the first `n` entries, so the traits of
 * `medium` are the first fifteen of `large`.
 */
export type TraitTemplate = {
  name: string;
  description: string;
};

export const traitPool: readonly TraitTemplate[] = [
  {
    name: 'Night owl',
    description:
      'Comes alive after dark and treats every sunrise as a personal inconvenience.',
  },
  {
    name: 'Escape artist',
    description:
      'No latch, lid or fence has held this one for longer than an afternoon.',
  },
  {
    name: 'Bottomless appetite',
    description:
      'Eats anything offered, anything dropped and anything left unattended for a second.',
  },
  {
    name: 'Afraid of thunder',
    description:
      'Disappears under the nearest furniture at the first rumble and reappears only for supper.',
  },
  {
    name: 'Natural leader',
    description:
      'The other animals follow without ever having been asked, which suits this one fine.',
  },
  {
    name: 'Terrible singer',
    description:
      'Performs at dawn with tremendous confidence and no discernible tune.',
  },
  {
    name: 'Collects buttons',
    description:
      'Keeps a growing heap of buttons somewhere nobody has found and will not say where.',
  },
  {
    name: 'Afraid of nothing',
    description:
      'Has stared down dogs, storms and one very surprised Beagle Boy without blinking.',
  },
  {
    name: 'Gentle with children',
    description:
      'Slows down, softens up and puts up with any amount of hugging from anyone under ten.',
  },
  {
    name: 'Weather forecaster',
    description:
      'Grows restless a full hour before rain, more reliably than the Duckburg Gazette.',
  },
  {
    name: 'Compulsive digger',
    description:
      'Leaves a fresh hole in every garden visited, occasionally with something interesting at the bottom.',
  },
  {
    name: 'Loves a bath',
    description:
      'Climbs into any water deep enough to sit in and leaves only when it goes cold.',
  },
  {
    name: 'Hates a bath',
    description:
      'Regards water as a personal attack and has the wet towels to prove it.',
  },
  {
    name: 'Talks back',
    description:
      'Answers every instruction with a noise that is unmistakably an opinion.',
  },
  {
    name: 'Sleeps anywhere',
    description:
      'Can nap on a fence post, a doormat or a moving wheelbarrow with equal ease.',
  },
  {
    name: 'Chases bicycles',
    description:
      'Has never caught one and shows no sign of learning from that.',
  },
  {
    name: 'Steals socks',
    description:
      'One sock of every pair in the house ends up in this one’s bed, never both.',
  },
  {
    name: 'Early riser',
    description:
      'Up before the milkman and convinced everyone else should be too.',
  },
  {
    name: 'Picky eater',
    description:
      'Inspects every meal for several minutes and rejects most of it on principle.',
  },
  {
    name: 'Remembers faces',
    description:
      'Greets an old friend after years apart and holds a grudge for exactly as long.',
  },
  {
    name: 'Shows off',
    description:
      'Performs every trick twice as soon as an audience appears, and thrice for a camera.',
  },
  {
    name: 'Hums while eating',
    description:
      'Produces a low, contented drone over every bowl that stops the moment the bowl is empty.',
  },
  {
    name: 'Guards the door',
    description:
      'Lies across the threshold every night and lets nobody in or out without a good look first.',
  },
  {
    name: 'Fond of hats',
    description:
      'Will wear any hat placed on its head and sulk when it is removed.',
  },
  {
    name: 'Dislikes cats',
    description:
      'Bristles at the sight, the smell and, some say, the mere mention of a cat.',
  },
  {
    name: 'Befriends everyone',
    description:
      'Has never met a stranger, an enemy or a delivery person it did not like.',
  },
  {
    name: 'Sulks when ignored',
    description:
      'Turns its back on the room and stays that way until somebody apologises.',
  },
  {
    name: 'Chews furniture',
    description:
      'Has tasted every chair leg in the house and ranks them by softness.',
  },
  {
    name: 'Reads the room',
    description:
      'Knows when to leave, when to stay and when to sit quietly on a lap.',
  },
  {
    name: 'Obsessed with squirrels',
    description:
      'Every walk stops dead the moment a squirrel appears, and the squirrels know it.',
  },
  {
    name: 'Hoards food',
    description:
      'Buries, hides or tucks away every biscuit for a rainy day that never comes.',
  },
  {
    name: 'Loves car rides',
    description:
      'Is in the passenger seat before the engine starts and hangs out of the window all the way.',
  },
  {
    name: 'Scared of the vacuum',
    description:
      'Treats the vacuum cleaner as a sworn enemy and retreats to high ground when it runs.',
  },
  {
    name: 'Untrainable',
    description:
      'Understands every command perfectly and has decided not to follow any of them.',
  },
  {
    name: 'Perfectly trained',
    description:
      'Sits, stays and fetches so well that visitors ask which academy it attended.',
  },
  {
    name: 'Adores the postman',
    description:
      'Waits by the gate every morning for the one visitor most animals would rather chase.',
  },
  {
    name: 'Climbs everything',
    description:
      'Has been retrieved from curtains, bookshelves and, once, the roof of the money bin.',
  },
  {
    name: 'Snores',
    description:
      'Can be heard from the next room and has been mistaken for a distant lawnmower.',
  },
  {
    name: 'Prefers the quiet',
    description:
      'Leaves the room when the radio comes on and returns only when it goes off.',
  },
  {
    name: 'Drama at mealtimes',
    description:
      'Acts as though it has not eaten in a week the moment a plate is set down.',
  },
  {
    name: 'Follows the sun',
    description:
      'Moves from window to window through the day and is never in the shade.',
  },
  {
    name: 'Loves the snow',
    description:
      'Waits all year for the first snowfall and then refuses to come inside.',
  },
  {
    name: 'Old soul',
    description:
      'Watches the world with the calm of an animal that has seen it all before.',
  },
  {
    name: 'Tidies its bed',
    description:
      'Rearranges the blanket every night until it is exactly right and then sighs.',
  },
  {
    name: 'Announces visitors',
    description:
      'Knows a footstep on the path a full minute before the doorbell and says so.',
  },
];
